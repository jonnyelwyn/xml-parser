# Code Signing & Notarisation Setup

## Context

XML Parser is a Tauri v2 + Next.js desktop app distributed outside the Mac App Store. Without signing and notarisation, users see "damaged and can't be opened" on macOS. The workaround (xattr -d com.apple.quarantine) works but requires Terminal knowledge.

## What's been done

- Updated `tauri.conf.json` identifier from `com.cutdaily.xmemlparser` → `com.editingtools.xmlparser`
- Confirmed the `Developer ID Application: Codebase Media UG (haftungsbeschrankt) (LZ28YRG3Q4)` cert is valid in Keychain (private key present)
- Signing works — Tauri successfully signs the .app with that identity
- Notarisation is blocked (see below)

## Current blocker

Notarisation via Apple ID (`jonnyelwyn@gmail.com`) failed because the Apple ID account is locked. Apple have said to wait "several days" before it can be unlocked. Apple ID approach is off the table for now.

## Solution: App Store Connect API key (needed from Rafael)

Rafael Maier is the Account Holder of the Codebase Media UG Apple Developer account (`LZ28YRG3Q4`). Only he can create App Store Connect API keys.

**Ask Rafael to:**
1. Go to App Store Connect → Users and Access → Integrations → App Store Connect API
2. Hit +, name it "Notarisation Key", role: Developer
3. Download the `.p8` file (only available once)
4. Share: the `.p8` file, the Key ID, and the Issuer ID

## Build command once Rafael provides the key

```bash
APPLE_SIGNING_IDENTITY="Developer ID Application: Codebase Media UG (haftungsbeschrankt) (LZ28YRG3Q4)" \
APPLE_API_KEY="/path/to/AuthKey_KEYID.p8" \
APPLE_API_ISSUER="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" \
npm run build
```

## Certificate inventory (from Keychain)

| # | Identity | Type |
|---|----------|------|
| 1 | Apple Development: jonny_2022@hotmail.com (3B5BJXFNAK) | Dev only |
| 2 | Apple Development: Jonathan Elwyn (6RLHM6U7M6) | Dev only |
| 4 | Developer ID Application: Codebase Media UG (haftungsbeschrankt) (LZ28YRG3Q4) | **Use this** |
| 5 | Apple Distribution: Codebase Media UG (haftungsbeschrankt) (LZ28YRG3Q4) | App Store only |

## Other apps in App Store Connect (same team)

- Claude Deck — `com.editingtools.claudedeck` (identifier to use for that project)
- Premiere XML Parser — registered, Prepare for Submission
- Transcriber Translator — Ready for Distribution
- Tidy Media Manager — Ready for Distribution

## Notes

- Certificates in the APPLE CERTIFICATES Dropbox folder belong to Rafael (Developer ID Application ones) and Jonny (Distribution, Development)
- Jonny does not have Account Holder role so cannot create App Store Connect API keys directly
- Do NOT use `npm audit fix --force` — can break dependencies
