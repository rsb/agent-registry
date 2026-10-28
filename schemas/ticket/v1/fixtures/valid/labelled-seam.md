---
id: S-0042/2
title: Invite expiry
slice: feature
depends_on: [S-0042/1]
serves: [app §2.1]
contracts:
  relies_on:
    - from: S-0042/1
      shape: the invites table with created_at
  provides:
    - to: external
      shape: expired invites refused at accept
seams:
  - unit: accept handler against a fake clock
  - "live: an invite older than seven days is refused"
---
