// An isolated consumer module, deliberately outside golang/ so it resolves the
// SDK the way an external project does rather than as a package in the same
// module.
//
// The replace directive is required rather than optional: the Go module proxy
// only serves a version that has already been tagged and published, so a
// pre-release check has no published version to fetch. Everything else here —
// the import path, the API used, the build — is exactly what a real consumer
// does.
module github.com/Oppex-AI/oppex-integration/.github/smoke/go

go 1.27

require github.com/Oppex-AI/oppex-integration/golang v0.0.0

replace github.com/Oppex-AI/oppex-integration/golang => ../../../golang
