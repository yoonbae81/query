import { ChatGptSite } from "../adapters/outbound/providers/chatgpt/chatgptSite";
import { runSiteProvider } from "./runtime";

runSiteProvider("chatgpt", new ChatGptSite());
