# ACE Vertex synthetic conflict fixture

fixture_version: vertex-conflict-v1
fixture_scope: synthetic-public-only
symbol: aceVertexConflictPolicy

This fixture intentionally represents an **outdated** architecture decision for acceptance testing.

Decision: `aceVertexConflictPolicy` must wait for explicit operator confirmation before retrying a failed connection.

The current source fixture intentionally disagrees with this statement. This document contains no private source, user dialogue, credentials, or production configuration.
