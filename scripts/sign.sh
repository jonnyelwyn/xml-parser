#!/bin/bash
# Fill in KEY_ID and ISSUER_ID once Rafael sends the API key.
# Store the .p8 file at ~/.appstoreconnect/private_keys/AuthKey_KEYID.p8

KEY_ID=""
ISSUER_ID=""
P8_PATH="$HOME/.appstoreconnect/private_keys/AuthKey_${KEY_ID}.p8"

APPLE_SIGNING_IDENTITY="Developer ID Application: Codebase Media UG (haftungsbeschrankt) (LZ28YRG3Q4)" \
APPLE_API_KEY="$P8_PATH" \
APPLE_API_ISSUER="$ISSUER_ID" \
npm run build
