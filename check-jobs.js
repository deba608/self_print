const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
const path = require("path");

const configPath = path.resolve(__dirname, "agent/config.json");
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));

const supabase = createClient(config.supabaseUrl, config.supabaseKey);

async function checkNonPrintedJobs() {
  console.log("Checking jobs that are not printed, cancelled, or pending_payment...");
  const { data: jobs, error } = await supabase
    .from("jobs")
    .select("*")
    .not("status", "in", '("printed","cancelled","pending_payment")')
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error fetching jobs:", error);
    return;
  }

  console.log(`Found ${jobs.length} jobs:`);
  for (const job of jobs) {
    console.log(`- ID: ${job.id}, Token: ${job.token}, Status: ${job.status}, Needs Conv: ${job.needs_conversion}, Created At: ${job.created_at}, Paid At: ${job.paid_at}`);
    // Fetch files
    const { data: file } = await supabase
      .from("job_files")
      .select("*")
      .eq("job_id", job.id)
      .single();
    if (file) {
      console.log(`  File: Name: ${file.original_name}, Path: ${file.storage_path}`);
    }
    // Fetch print events
    const { data: events } = await supabase
      .from("print_events")
      .select("*")
      .eq("job_id", job.id)
      .order("created_at", { ascending: false });
    if (events && events.length > 0) {
      console.log("  Events:");
      for (const event of events) {
        console.log(`    * [${event.created_at}] ${event.event_type}: ${event.message}`);
      }
    }
  }
}

checkNonPrintedJobs().catch(console.error);
