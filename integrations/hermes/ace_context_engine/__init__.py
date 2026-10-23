from __future__ import annotations

from .engine import AceContextEngine

engine = AceContextEngine()


def register(context):
    context.register_context_engine(engine)
