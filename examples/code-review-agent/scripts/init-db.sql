-- ====================================================================
-- Njent Code Review Agent — Database Initialization & Migrations
-- ====================================================================

-- 1. Enable pgvector extension for dense semantic embeddings
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. Codebase Chunks Table (AST Semantic Chunks & Graph Dependencies)
CREATE TABLE IF NOT EXISTS codebase_chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_path VARCHAR(500) NOT NULL,
    package_name VARCHAR(100) NOT NULL,
    chunk_type VARCHAR(50) NOT NULL, -- 'class' | 'interface' | 'method' | 'doc'
    symbol_name VARCHAR(250) NOT NULL,
    parent_symbol VARCHAR(250),
    dependencies TEXT[] DEFAULT '{}',
    start_line INT NOT NULL,
    end_line INT NOT NULL,
    content TEXT NOT NULL,
    embedding vector(1536),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for Hybrid Search (Dense HNSW + Sparse Full-Text Search)
CREATE INDEX IF NOT EXISTS idx_codebase_chunks_hnsw 
    ON codebase_chunks USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS idx_codebase_chunks_fts 
    ON codebase_chunks USING gin (to_tsvector('english', content));

CREATE INDEX IF NOT EXISTS idx_codebase_chunks_dependencies 
    ON codebase_chunks USING gin (dependencies);

-- 3. Semantic Memory Rules Table (Architectural Invariants & Coding Standards)
CREATE TABLE IF NOT EXISTS semantic_memory_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category VARCHAR(100) NOT NULL, -- 'architecture_rule' | 'coding_standard' | 'security_rule'
    concept VARCHAR(250) NOT NULL,
    rule_statement TEXT NOT NULL,
    embedding vector(1536),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_semantic_rules_hnsw 
    ON semantic_memory_rules USING hnsw (embedding vector_cosine_ops);

-- 4. Episodic Experience Table (Historical PR Reviews & Maintainer Feedback)
CREATE TABLE IF NOT EXISTS episodic_experience_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_pr INT NOT NULL,
    file_modified VARCHAR(500) NOT NULL,
    line_range INT[] NOT NULL,
    maintainer_action VARCHAR(50) NOT NULL, -- 'accepted' | 'dismissed' | 'marked_false_positive'
    comment_summary TEXT NOT NULL,
    maintainer_explanation TEXT,
    importance_score NUMERIC(3,2) DEFAULT 0.50,
    embedding vector(1536),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_episodic_experience_hnsw 
    ON episodic_experience_events USING hnsw (embedding vector_cosine_ops);

-- 5. Audit Events Table (OpenTelemetry GenAI Semantic Conventions)
CREATE TABLE IF NOT EXISTS audit_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trace_id VARCHAR(100) NOT NULL,
    session_id VARCHAR(100) NOT NULL,
    event_type VARCHAR(100) NOT NULL,
    actor VARCHAR(150) NOT NULL,
    tool_name VARCHAR(150),
    decision VARCHAR(50),
    gen_ai_system VARCHAR(50) DEFAULT 'openai',
    gen_ai_model VARCHAR(100),
    prompt_tokens INT DEFAULT 0,
    completion_tokens INT DEFAULT 0,
    cost_usd NUMERIC(10,6) DEFAULT 0.0,
    duration_ms INT DEFAULT 0,
    payload JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_trace_id ON audit_events (trace_id);
CREATE INDEX IF NOT EXISTS idx_audit_session_id ON audit_events (session_id);
