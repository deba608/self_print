import { getDb, getPricing } from "../src/lib/db";
import { DEFAULT_ADMIN_PASSWORD, DEFAULT_ADMIN_USERNAME, DEFAULT_AGENT_TOKEN } from "../src/lib/config";

getDb();
const pricing = getPricing();

console.log("SelfPrint database is ready.");
console.log(`Admin username: ${DEFAULT_ADMIN_USERNAME}`);
console.log(`Admin password/PIN: ${DEFAULT_ADMIN_PASSWORD}`);
console.log(`Agent token: ${DEFAULT_AGENT_TOKEN}`);
console.log("Pricing:", pricing);
