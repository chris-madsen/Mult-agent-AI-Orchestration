from __future__ import annotations

from .engine import AceContextEngine

def register_context_engine(context):
    context.register_context_engine(AceContextEngine())


register = register_context_engine
