import base64
import json
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

import aiosqlite

from src.domain.entities import Query, QueryResult, ResultStatus, utcnow
from src.domain.ports import QueryPage, QueryRepositoryPort

_SCHEMA = """
CREATE TABLE IF NOT EXISTS queries (
    id TEXT PRIMARY KEY,
    query_text TEXT NOT NULL,
    batch_id TEXT,
    providers TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS query_results (
    id TEXT PRIMARY KEY,
    query_id TEXT NOT NULL REFERENCES queries(id),
    provider TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    progress_message TEXT,
    answer TEXT,
    citations TEXT,
    answer_file_path TEXT,
    system_prompt_snapshot TEXT,
    error_message TEXT,
    retry_count INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TEXT,
    priority INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (query_id, provider)
);
CREATE INDEX IF NOT EXISTS idx_results_pending ON query_results (status, priority DESC, created_at);
CREATE INDEX IF NOT EXISTS idx_queries_created ON queries (created_at DESC, id DESC);
"""


def _ts(dt: datetime) -> str:
    """UTC ISO 문자열 (사전순 비교가 시간순과 일치하도록 형식을 고정)."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat(timespec="microseconds")


def _dt(value: str | None) -> datetime | None:
    if value is None:
        return None
    dt = datetime.fromisoformat(value)
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _to_query(row: aiosqlite.Row) -> Query:
    return Query(
        id=row["id"],
        query_text=row["query_text"],
        providers=json.loads(row["providers"]),
        batch_id=row["batch_id"],
        created_at=_dt(row["created_at"]),
    )


def _to_result(row: aiosqlite.Row) -> QueryResult:
    return QueryResult(
        id=row["id"],
        query_id=row["query_id"],
        provider=row["provider"],
        status=ResultStatus(row["status"]),
        priority=row["priority"],
        progress_message=row["progress_message"],
        answer=row["answer"],
        citations=json.loads(row["citations"]) if row["citations"] is not None else None,
        answer_file_path=row["answer_file_path"],
        system_prompt_snapshot=row["system_prompt_snapshot"],
        error_message=row["error_message"],
        retry_count=row["retry_count"],
        next_attempt_at=_dt(row["next_attempt_at"]),
        created_at=_dt(row["created_at"]),
        updated_at=_dt(row["updated_at"]),
    )


_INSERT_RESULT = (
    "INSERT OR IGNORE INTO query_results "
    "(id, query_id, provider, status, priority, retry_count, created_at, updated_at) "
    "VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
)


def _result_params(r: QueryResult) -> tuple:
    return (r.id, r.query_id, r.provider, r.status.value, r.priority, r.retry_count, _ts(r.created_at), _ts(r.updated_at))


class SqliteQueryRepositoryAdapter(QueryRepositoryPort):
    def __init__(self, db_path: str | Path):
        self._db_path = str(db_path)

    @asynccontextmanager
    async def _conn(self):
        db = await aiosqlite.connect(self._db_path, timeout=5)
        try:
            db.row_factory = aiosqlite.Row
            await db.execute("PRAGMA busy_timeout=5000")
            await db.execute("PRAGMA foreign_keys=ON")
            yield db
            await db.commit()
        except BaseException:
            await db.rollback()
            raise
        finally:
            await db.close()

    async def init(self) -> None:
        Path(self._db_path).parent.mkdir(parents=True, exist_ok=True)
        async with self._conn() as db:
            await db.execute("PRAGMA journal_mode=WAL")
            await db.executescript(_SCHEMA)

    async def create_queries(self, items: list[tuple[Query, list[QueryResult]]]) -> None:
        async with self._conn() as db:
            for q, results in items:
                await db.execute(
                    "INSERT INTO queries (id, query_text, batch_id, providers, created_at) VALUES (?, ?, ?, ?, ?)",
                    (q.id, q.query_text, q.batch_id, json.dumps(q.providers), _ts(q.created_at)),
                )
                await db.executemany(_INSERT_RESULT, [_result_params(r) for r in results])

    async def add_results(self, query_id: str, results: list[QueryResult]) -> list[QueryResult]:
        added: list[QueryResult] = []
        async with self._conn() as db:
            for r in results:
                cur = await db.execute(_INSERT_RESULT, _result_params(r))
                if cur.rowcount == 1:
                    added.append(r)
            if added:
                cur = await db.execute("SELECT providers FROM queries WHERE id=?", (query_id,))
                row = await cur.fetchone()
                providers = json.loads(row["providers"]) if row else []
                providers += [r.provider for r in added if r.provider not in providers]
                await db.execute("UPDATE queries SET providers=? WHERE id=?", (json.dumps(providers), query_id))
        return added

    async def get_query(self, query_id: str) -> Query | None:
        async with self._conn() as db:
            cur = await db.execute("SELECT * FROM queries WHERE id=?", (query_id,))
            row = await cur.fetchone()
            return _to_query(row) if row else None

    async def get_results(self, query_id: str) -> list[QueryResult]:
        async with self._conn() as db:
            cur = await db.execute(
                "SELECT * FROM query_results WHERE query_id=? ORDER BY created_at, id", (query_id,)
            )
            return [_to_result(r) for r in await cur.fetchall()]

    async def get_result(self, result_id: str) -> QueryResult | None:
        async with self._conn() as db:
            cur = await db.execute("SELECT * FROM query_results WHERE id=?", (result_id,))
            row = await cur.fetchone()
            return _to_result(row) if row else None

    async def list_queries(
        self, status: str | None, batch_id: str | None, limit: int, cursor: str | None
    ) -> QueryPage:
        where, params = [], []
        if status:
            where.append("EXISTS (SELECT 1 FROM query_results r WHERE r.query_id=q.id AND r.status=?)")
            params.append(status)
        if batch_id:
            where.append("q.batch_id=?")
            params.append(batch_id)
        if cursor:
            c = json.loads(base64.urlsafe_b64decode(cursor.encode()))
            where.append("(q.created_at, q.id) < (?, ?)")
            params += [c["created_at"], c["id"]]
        sql = "SELECT q.* FROM queries q"
        if where:
            sql += " WHERE " + " AND ".join(where)
        sql += " ORDER BY q.created_at DESC, q.id DESC LIMIT ?"
        params.append(limit + 1)

        async with self._conn() as db:
            rows = await (await db.execute(sql, params)).fetchall()
            has_more = len(rows) > limit
            rows = rows[:limit]
            queries = [_to_query(r) for r in rows]
            by_query: dict[str, list[QueryResult]] = {q.id: [] for q in queries}
            if queries:
                marks = ",".join("?" * len(queries))
                cur = await db.execute(
                    f"SELECT * FROM query_results WHERE query_id IN ({marks}) ORDER BY created_at, id",
                    [q.id for q in queries],
                )
                for r in await cur.fetchall():
                    by_query[r["query_id"]].append(_to_result(r))

        next_cursor = None
        if has_more and rows:
            last = rows[-1]
            raw = json.dumps({"created_at": last["created_at"], "id": last["id"]})
            next_cursor = base64.urlsafe_b64encode(raw.encode()).decode()
        return QueryPage(items=[(q, by_query[q.id]) for q in queries], next_cursor=next_cursor)

    async def claim_pending(self, now: datetime, limit: int) -> list[QueryResult]:
        if limit <= 0:
            return []
        claimed: list[QueryResult] = []
        async with self._conn() as db:
            cur = await db.execute(
                "SELECT * FROM query_results WHERE status='pending' "
                "AND (next_attempt_at IS NULL OR next_attempt_at <= ?) "
                "ORDER BY priority DESC, created_at ASC, id ASC LIMIT ?",
                (_ts(now), limit),
            )
            for row in await cur.fetchall():
                upd = await db.execute(
                    "UPDATE query_results SET status='processing', progress_message='시작', updated_at=? "
                    "WHERE id=? AND status='pending'",
                    (_ts(utcnow()), row["id"]),
                )
                if upd.rowcount == 1:
                    r = _to_result(row)
                    r.status, r.progress_message = ResultStatus.PROCESSING, "시작"
                    claimed.append(r)
        return claimed

    async def _update(self, result_id: str, sets: str, params: tuple) -> int:
        async with self._conn() as db:
            cur = await db.execute(
                f"UPDATE query_results SET {sets}, updated_at=? WHERE id=?", (*params, _ts(utcnow()), result_id)
            )
            return cur.rowcount

    async def set_progress(self, result_id: str, message: str | None) -> None:
        await self._update(result_id, "progress_message=?", (message,))

    async def set_system_prompt_snapshot(self, result_id: str, snapshot: str) -> None:
        await self._update(result_id, "system_prompt_snapshot=?", (snapshot,))

    async def mark_done(self, result_id: str, answer: str, citations: list[str], answer_file_path: str) -> None:
        await self._update(
            result_id,
            "status='done', answer=?, citations=?, answer_file_path=?, progress_message=NULL, error_message=NULL",
            (answer, json.dumps(citations, ensure_ascii=False), answer_file_path),
        )

    async def schedule_retry(self, result_id: str, error_message: str, next_attempt_at: datetime) -> None:
        await self._update(
            result_id,
            "status='pending', retry_count=retry_count+1, error_message=?, progress_message=NULL, next_attempt_at=?",
            (error_message, _ts(next_attempt_at)),
        )

    async def mark_failed(self, result_id: str, error_message: str) -> None:
        await self._update(
            result_id,
            "status='failed', retry_count=retry_count+1, error_message=?, progress_message=NULL",
            (error_message,),
        )

    async def reset_for_retry(self, result_id: str) -> bool:
        async with self._conn() as db:
            cur = await db.execute(
                "UPDATE query_results SET status='pending', retry_count=0, error_message=NULL, "
                "progress_message=NULL, next_attempt_at=NULL, updated_at=? WHERE id=? AND status='failed'",
                (_ts(utcnow()), result_id),
            )
            return cur.rowcount == 1

    async def recover_processing(self) -> int:
        async with self._conn() as db:
            cur = await db.execute(
                "UPDATE query_results SET status='pending', progress_message=NULL, updated_at=? "
                "WHERE status='processing'",
                (_ts(utcnow()),),
            )
            return cur.rowcount

    async def find_expired(self, cutoff: datetime) -> list[QueryResult]:
        async with self._conn() as db:
            cur = await db.execute(
                "SELECT * FROM query_results WHERE status IN ('done','failed') AND updated_at < ?",
                (_ts(cutoff),),
            )
            return [_to_result(r) for r in await cur.fetchall()]

    async def delete_results(self, result_ids: list[str]) -> None:
        if not result_ids:
            return
        marks = ",".join("?" * len(result_ids))
        async with self._conn() as db:
            await db.execute(f"DELETE FROM query_results WHERE id IN ({marks})", result_ids)
            await db.execute(
                "DELETE FROM queries WHERE NOT EXISTS (SELECT 1 FROM query_results r WHERE r.query_id=queries.id)"
            )
