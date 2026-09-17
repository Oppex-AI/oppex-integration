//! Post incidents to the Oppex incident API.
//!
//! ```text
//! POST https://api.oppex.ai/api/v1/incident/post
//! ```
//!
//! Create one [`IncidentClient`] per application, share it across threads, and
//! let it drop (or call [`IncidentClient::close`]) during shutdown.
//!
//! ```no_run
//! use oppex_sdk::{IncidentClient, IncidentRequest, Severity};
//!
//! # fn main() -> Result<(), Box<dyn std::error::Error>> {
//! let client = IncidentClient::builder()
//!     .api_key("api-key")
//!     .service_key("service-key")
//!     .build()?;
//!
//! let request = IncidentRequest::builder()
//!     .title("Checkout latency breached the SLO")
//!     .source("checkout-api")
//!     .severity(Severity::High)
//!     .build()?;
//!
//! let response = client.post(&request)?;
//! println!("created {:?}", response.incident_id());
//! # Ok(())
//! # }
//! ```
//!
//! The service key is optional. A client built with only an API key posts with
//! [`IncidentClient::post_with_service_routing`], which omits `serviceKey` from
//! the payload so the API resolves the target service itself.

mod client;
mod error;
mod internal;
mod request;
mod response;
mod severity;

/// The SDK version, as `MAJOR.MINOR.PATCH`. Read from the crate's own manifest,
/// so it cannot drift from the published version.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

pub use client::{IncidentClient, IncidentClientBuilder};
pub use error::{IncidentError, NO_STATUS_CODE};
pub use internal::transport::DEFAULT_ENDPOINT;
pub use request::{IncidentRequest, IncidentRequestBuilder};
pub use response::IncidentResponse;
pub use severity::Severity;
