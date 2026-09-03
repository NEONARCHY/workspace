# Server readiness — initial profile

## Confirmed hardware

- CPU: Intel Core i9, 13th generation
- RAM: 32 GB
- GPU: NVIDIA GeForce RTX 3070

This is sufficient for the current Yuksalish application stack, PostgreSQL, Redis, MinIO,
background workers and a moderate pilot load. The RTX 3070 is not required for the core
platform; it can later be used for approved local AI workloads.

## Still required before production

- Exact Windows edition/build and administrator access
- System disk type, total capacity and free space
- Separate second physical disk for local backups
- UPS model and expected runtime during a power outage
- Stable local network connection and preferably a reserved LAN address
- Backup destination outside the server and an assigned restore-test owner
- Domain, Cloudflare account and administrative access

A single powerful PC is still a single point of failure. CPU and GPU performance do not
replace a second disk, UPS, external encrypted backup and a tested restoration procedure.

## Initial resource policy

- Reserve at least 8 GB RAM for Windows and operational tools.
- Start the Docker stack with a combined working budget of up to 20 GB RAM.
- Keep databases and MinIO on SSD/NVMe storage.
- Do not begin production use with less than 200 GB free working space.
- Store backups on a different physical disk and keep an encrypted external copy.
- Expose no database, Redis or MinIO ports to the LAN or internet.

These are initial safety bounds, not final capacity numbers. They must be revised using
measured pilot data, file growth and backup duration.

## Domain and Cloudflare status

No domain or Cloudflare account exists yet. Development and local staging can continue on
`127.0.0.1`; public access, remote pilot access and production cutover remain blocked until
the user creates or selects a domain and grants access to a Cloudflare account.
