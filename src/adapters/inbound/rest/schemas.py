from pydantic import BaseModel


class SubmitRequest(BaseModel):
    query: str
    providers: list[str] | None = None


class BulkSubmitRequest(BaseModel):
    queries: list[str]
    providers: list[str] | None = None


class AddProvidersRequest(BaseModel):
    providers: list[str]


class AskRequest(BaseModel):
    question: str
    providers: list[str] | None = None


class SystemPromptRequest(BaseModel):
    content: str
