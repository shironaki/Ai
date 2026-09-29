"""Backward-compatible import shim for the modular AI service."""

from services.ai_service import generate_reply

__all__ = ["generate_reply"]
