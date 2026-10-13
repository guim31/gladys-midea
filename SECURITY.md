# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, keys, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes, in
particular:

- **What is stored in `/data`** (`midea-state.json`, mode 0600): for each unit
  found, its address, device id, protocol version, capabilities, last filter
  and error state, and, for the V3 units, the **token and key** fetched from the
  Midea cloud. Whoever reads this file can control those units on the local
  network.
- **Secrets of the configuration**: the optional NetHome Plus account and
  password. The password is only sent to the Midea cloud, hashed as the
  NetHome Plus app does; it is never logged, nor are the tokens, the keys or
  the session keys.
- **Network**: the integration talks to the units in TCP on port 6444 of the
  local network, asks the Gladys core to broadcast the Midea discovery request
  (UDP 6445 and 20086, declared in the manifest), sends that request in unicast
  to the typed addresses, and reaches `https://mapp.appsmb.com` (Midea's
  NetHome Plus cloud) only to fetch the key of a V3 unit that has none.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
the Midea cloud, the units' firmware and the security of the Midea LAN protocol
itself (its V2 encryption uses a key shared by every module).
