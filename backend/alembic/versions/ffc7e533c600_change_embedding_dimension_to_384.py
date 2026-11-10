"""change embedding dimension to 384

Revision ID: ffc7e533c600
Revises: 8fed1142255c
Create Date: 2026-11-10 20:36:31.767905
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'ffc7e533c600'
down_revision: Union[str, None] = '8fed1142255c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Drop the old vector column and recreate with new dimension
    # Old vectors (2048-dim) are incompatible with new model (384-dim)
    op.execute("ALTER TABLE document_chunks DROP COLUMN IF EXISTS embedding")
    op.execute("ALTER TABLE document_chunks ADD COLUMN embedding vector(384)")
    # Recreate the HNSW index for the new dimension
    op.execute("DROP INDEX IF EXISTS ix_document_chunks_embedding")
    op.execute("CREATE INDEX ix_document_chunks_embedding ON document_chunks USING hnsw (embedding vector_cosine_ops)")


def downgrade() -> None:
    # Revert to 2048 dims
    op.execute("ALTER TABLE document_chunks DROP COLUMN IF EXISTS embedding")
    op.execute("ALTER TABLE document_chunks ADD COLUMN embedding vector(2048)")
    op.execute("DROP INDEX IF EXISTS ix_document_chunks_embedding")
    op.execute("CREATE INDEX ix_document_chunks_embedding ON document_chunks USING hnsw (embedding vector_cosine_ops)")
