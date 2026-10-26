from __future__ import annotations


def register_context_engine(context):
    # Transport/receipt imports must not eagerly initialize Hermes's heavy
    # compressor or require a running agent. Hermes loads this only at registration.
    from .engine import AceContextEngine
    context.register_context_engine(AceContextEngine())


register = register_context_engine
