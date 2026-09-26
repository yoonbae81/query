import { GeminiSite } from "../adapters/outbound/providers/gemini/geminiSite";
import { runSiteProvider } from "./runtime";

runSiteProvider("gemini", new GeminiSite());
