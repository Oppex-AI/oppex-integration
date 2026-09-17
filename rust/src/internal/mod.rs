//! Implementation details. Nothing in this module is public API, and every item
//! here may change in any release.

pub(crate) mod dispatcher;
pub(crate) mod drop_logger;
pub(crate) mod interrupt;
pub(crate) mod retry;
pub(crate) mod transport;
pub(crate) mod wire;
