import { PerplexitySite } from "../adapters/outbound/providers/perplexity/perplexitySite";
import { runSiteProvider } from "./runtime";

runSiteProvider("perplexity", new PerplexitySite());
