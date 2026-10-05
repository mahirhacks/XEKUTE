# Local node-forge security backport

This is node-forge 1.4.0 with the RSA DigestAlgorithm element-count fix from
digitalbazaar/forge PR #1152 (commit ceba344). It uses the proposed 1.4.1
version so npm does not consider the unpatched 1.4.0 release installed.

Keep the upstream license and package files intact. Replace this local override
with the official fixed node-forge release once it is published.
