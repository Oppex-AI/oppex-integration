//! Posts one incident synchronously and one asynchronously.
//!
//! ```shell
//! OPPEX_API_KEY=... OPPEX_SERVICE_KEY=... cargo run --example plain
//! ```

use std::env;
use std::error::Error;

use oppex_sdk::{IncidentClient, IncidentRequest, Severity};

fn main() -> Result<(), Box<dyn Error>> {
    let client = IncidentClient::builder()
        .api_key(env::var("OPPEX_API_KEY")?)
        .service_key(env::var("OPPEX_SERVICE_KEY")?)
        .build()?;

    let request = IncidentRequest::builder()
        .title("Checkout latency breached the SLO")
        .source("checkout-api")
        .severity(Severity::High)
        .priority(2)
        .component("payments")
        .group("platform")
        .incident_type("latency")
        .details(r#"{"p99Millis":1200,"threshold":800}"#)
        .build()?;

    let response = client.post(&request)?;
    println!(
        "incident {:?} created (code {})",
        response.incident_id(),
        response.code()
    );

    // Fire and forget. Validation still fails fast here; a delivery failure
    // after this point is logged rather than returned.
    let queued = IncidentRequest::builder()
        .title("Background job queue is backing up")
        .source("worker")
        .severity(Severity::Low)
        .build()?;
    client.post_async(queued)?;

    // Dropping the client closes it, draining queued incidents for up to ten
    // seconds. Closing explicitly makes that ordering obvious.
    client.close();
    Ok(())
}
