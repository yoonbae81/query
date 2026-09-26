import { ClaudeSite } from "../adapters/outbound/providers/claude/claudeSite";
import { runSiteProvider } from "./runtime";

runSiteProvider("claude", new ClaudeSite());
