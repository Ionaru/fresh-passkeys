# Overview

This document specifies the purpose, design principles, and architecture of the
fresh-passkeys plugin. For behavioral detail see the related specifications:
[Ceremonies](./ceremonies.md), [Storage Port](./storage-port.md),
[Configuration](./configuration.md), [HTTP API](./http-api.md), and
[Client](./client.md).

## Purpose

fresh-passkeys is a passwordless authentication plugin for the Fresh 2.x web
framework. It lets a host application authenticate users with passkeys
(credentials backed by device biometrics or a hardware security key) instead of
passwords.

Passkeys remove an entire class of risk. There is no shared secret to phish, no
password to reuse across sites, and nothing meaningful to steal in a server-side
breach: the server only ever stores public keys. The trade-off is that the
WebAuthn protocol underpinning passkeys is unforgiving. Challenge generation,
signature verification, origin checking, and replay-counter handling must all be
exactly correct, or the resulting system is silently insecure.

The plugin exists to own those exacting parts so the host does not reimplement
cryptography. It performs the WebAuthn ceremonies, manages challenge lifetimes,
verifies credentials, and maintains replay-protection counters. Everything that
is specific to the host application (the user model, sessions, database, and
user interface) stays under the host's control.

## Design principles

- **UI-free.** The plugin renders nothing. The host owns all markup, styling,
  and interactive components. The plugin exposes only HTTP endpoints and a small
  browser helper that drives them.
- **Storage-agnostic.** The plugin never talks to a database directly. It
  depends on a storage port that the host implements over whatever backend it
  prefers (relational database, in-memory map, key-value cache, and so on).
- **Host owns identity.** Creating user accounts, issuing sessions, and choosing
  the shape of the user record are all host responsibilities. The plugin reaches
  into the host's world only through narrowly typed hooks.
- **Plugin owns the ceremony.** Challenge issuance and expiry, credential
  verification, origin enforcement, and signature-counter updates belong to the
  plugin and are not configurable in ways that could weaken them.

## Architecture model

The plugin inverts its dependencies. Rather than reaching out to host
infrastructure, it declares the capabilities it needs and the host supplies them
at registration time. Two mechanisms carry this:

- **The storage port.** A set of capabilities for persisting and retrieving
  challenges and credentials, and for reading back the small amounts of user
  data the ceremonies require. The plugin calls these capabilities; the host
  implements them. See [Storage Port](./storage-port.md).
- **The hooks.** Functions the host provides so the plugin can read the current
  session's user and hand control back to the host at the two moments that touch
  identity: when a registration is verified and when a login is verified. See
  [Configuration](./configuration.md).

Because the plugin depends only on these host-supplied capabilities and never
the reverse, the host keeps full ownership of its data and session model while
the plugin keeps full ownership of protocol correctness.

## Two entry points

The package is published with two separate entry points, deliberately kept apart
so that server-only code never leaks into a browser bundle:

- **Server entry point.** Provides the registration function that mounts the
  ceremony endpoints onto a Fresh application, together with the configuration,
  storage-port, and data-shape contracts the host implements against.
- **Client entry point.** Provides a small, interface-free browser helper that
  drives the ceremony endpoints from the host's own components, plus a typed
  error surface for handling WebAuthn failures.

The responsibility boundary follows the entry points: the server side decides
what is cryptographically valid and what is persisted; the client side only
relays the browser's WebAuthn interaction to and from the server.

## Document map

- [Ceremonies](./ceremonies.md): the three authentication ceremonies, the
  challenge lifecycle, and replay protection.
- [Storage Port](./storage-port.md): the capabilities the host must implement
  and the data shapes that cross the boundary.
- [Configuration](./configuration.md): required and optional configuration and
  the host hooks.
- [HTTP API](./http-api.md): the endpoint and status-code contract.
- [Client](./client.md): the browser helper contract.
