# Enhanced Web Search

**Status**: 📋 DRAFT  
**Proposal Date**: 2025-01-04  
**Assigned To**: @laynepenney  
**Estimated Effort**: 3 weeks (phased)  
**Priority**: MEDIUM

---

## Overview

### What is this feature?

Enhanced web search capabilities for Codi that improve search reliability, result quality, and user experience beyond the current DuckDuckGo Lite implementation.

### Problem Statement

The current web search implementation has several limitations:

1. **DuckDuckGo Lite limitations**: Uses a basic HTML interface that's less reliable than API-based search
2. **No pagination**: Limited to 10 results maximum per query
3. **Fragile parsing**: HTML scraping can break with website changes
4. **No filtering**: Can't search specific sites, date ranges, or result types
5. **Frequent API failures**: DuckDuckGo rate limiting affects reliability
6. **No caching**: Same searches are performed repeatedly
7. **Limited result processing**: Basic link/snippet extraction with no content analysis

### Solution

A multi-engine web search system with:
- Multiple search engine support (DuckDuckGo, Google, Bing, Brave)
- Query optimization and search templates for common use cases
- Robust parsing with fallbacks
- Search caching and rate limiting
- Domain-specific result processing

---

## Goals

- [ ] Improve search reliability and uptime
- [ ] Increase result quality and relevance
- [ ] Add domain-specific search templates (docs, pricing, errors)
- [ ] Implement intelligent caching to reduce API calls
- [ ] Support multiple search engines as fallbacks
- [ ] Extract structured data from search results

## Non-Goals

- Real-time web crawling or scraping beyond search results
- Full-page content extraction without user consent
- Paid API services that require subscriptions
- Image or video search capabilities

---

## Background & Context

### Current State
The current web search tool uses DuckDuckGo's lite interface with HTML parsing, returning 5-10 results per query. It handles basic web searches but struggles with:
- Rate limiting from DuckDuckGo
- Changes to DuckDuckGo's HTML structure
- Lack of advanced search features
- Inconsistent result quality

### Prior Art
- **SERP APIs**: Commercial services like SerpAPI, Serply for structured results
- **Google Custom Search**: Expensive but reliable API
- **Brave Search API**: Privacy-focused with JSON API
- **Bing Search API**: Microsoft's search API

### User Stories

As a developer using Codi, I want:
- To search for current API pricing information with structured results
- To search documentation sites specifically for technical solutions  
- To resolve error messages with relevant Stack Overflow results
- To compare information across multiple sources with confidence scores
- To avoid repeated searches for the same queries

---

## Proposed Design

### Technical Approach

A modular search engine system with:
1. **Engine Registry**: Plug-in architecture for search providers
2. **Query Optimizer**: Automatic query refinement for technical searches
3. **Result Processor**: Domain-specific parsing and content extraction
4. **Cache Layer**: Persistent storage of frequent searches
5. **Quality Scorer**: Result relevance ranking

### Architecture

```typescript
┌─────────────────────────────────────────┐
│            EnhancedWebSearchTool         │
├─────────────────────────────────────────┤
│  ┌─ Engine Registry                     │
│  │ ├─ DuckDuckGoEngine (primary)        │
│  │ ├─ GoogleEngine (fallback)           │
│  │ ├─ BingEngine (backup)               │
│  │ └─ BraveEngine (privacy-focused)     │
│  │                                       │
│  ├─ Query Optimizer                     │
│  │ ├─ Search templates                  │
│  │ ├─ Domain-specific optimization      │
│  │ └─ Auto-complete suggestions         │
│  │                                       │
│  ├─ Result Processor                    │
│  │ ├─ Structured data extraction         │
│  │ ├─ Site-specific parsers              │
│  │ ├─ Content fetching (limited)        │
│  │ └─ Cross-source comparison           │
│  │                                       │
│  ├─ Cache Layer                         │
│  │ ├─ Persistent storage                │
│  │ ├─ TTL-based expiration              │
│  │ └─ Cache warm-up for common queries │
│  │                                       │
│  └─ Quality Scorer                      │
│    ├─ Domain authority scoring          │
│    ├─ Content freshness                │
│    ├─ User feedback integration        │
│    └─ Spam detection                   │
└─────────────────────────────────────────┘
```

### API/UI Changes

**New Configuration Options** (".codi.json"):
```json
{
  "webSearch": {
    "engines": ["duckduckgo", "google", "bing"],
    "cacheEnabled": true,
    "cacheTTL": 3600,
    "maxResults": 15,
    "templates": {
      "docs": {
        "sites": ["stackoverflow.com", "docs.python.org"],
        "sort": "relevance"
      },
      "pricing": {
        "sites": ["openai.com", "anthropic.com"],
        "sort": "date"
      }
    }
  }
}
```

**Enhanced Tool Parameters**:
```typescript
interface EnhancedWebSearchInput {
  query: string;
  num_results?: number;
  engine?: 'duckduckgo' | 'google' | 'bing' | 'brave';
  template?: 'docs' | 'pricing' | 'errors' | 'general';
  site_filter?: string[];
  date_range?: 'week' | 'month' | 'year' | 'all';
  extract_content?: boolean;
}
```

---

## Implementation Plan

### Phase 1: Multi-Engine Foundation (1 week)
- [ ] Engine registry with plugin interface
- [ ] DuckDuckGo API integration (primary)
- [ ] Google Search fallback (using SerpAPI free tier)
- [ ] Engine fallback and retry logic
- [ ] Configuration schema and validation

### Phase 2: Enhanced Features (1 week)
- [ ] Search templates and query optimization
- [ ] Result caching with file-based persistence
- [ ] Domain-specific parsers (Stack Overflow, GitHub, docs)
- [ ] Enhanced result formatting with relevance scores

### Phase 3: Advanced Capabilities (1 week)
- [ ] Cross-source comparison and aggregation
- [ ] Structured data extraction (pricing tables, APIs)
- [ ] Automatic fact checking and verification
- [ ] User feedback system for result quality

**Timeline**: 3 weeks

---

## Alternatives Considered

| Option | Pros | Cons | Decision |
|--------|------|------|----------|
| **SERP Service Integration** | Reliable, structured data | Paid service, API limits | ❌ Too costly |
| **Browser Automation** | Full JavaScript support | Heavy, slow, complex | ❌ Too resource-intensive |
| **Multiple Free APIs** | No cost, redundancy | Rate limiting, maintenance | ✅ Selected approach |
| **Enhanced Scraping** | Works with current model | Fragile to changes | ✅ Part of Phase 2 |

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Search engine API changes | High | Plugin architecture, automated monitoring |
| Rate limiting | Medium | Circuit breaker, retry with backoff, caching |
| Third-party API costs | Medium | Use free tiers, monitor usage, fallbacks |
| Feature creep | Medium | Stick to phased implementation plan |

---

## Success Criteria

### Must Have (MVP)
- [ ] Multi-engine support with fallbacks
- [ ] Improved reliability over current implementation
- [ ] Search templates for common use cases
- [ ] Basic caching to reduce duplicate searches

### Should Have
- [ ] Domain-specific result processing
- [ ] Structured data extraction from common sites
- [ ] Quality scoring for result relevance

### Nice to Have
- [ ] Cross-source verification system
- [ ] User feedback for result quality improvement
- [ ] Automated search engine health monitoring

---

## Testing Strategy

- **Unit tests**: Engine plugins, parsers, caching
- **Integration tests**: End-to-end search flows with mocked APIs
- **Manual testing**: Search templates, multi-engine fallbacks
- **Performance testing**: Caching effectiveness, API response times

---

## Open Questions

1. Should we integrate paid API services (SerpAPI) with cost monitoring?
2. What cache TTL is optimal for different search types?
3. How to handle search engine quotas and rate limiting effectively?
4. Should we include content extraction beyond snippet level?

---

## References

- Current implementation: `src/tools/web-search.ts`
- DuckDuckGo API: https://duckduckgo.com/api
- Google Custom Search API: https://developers.google.com/custom-search
- Brave Search API: https://brave.com/search/api/

---

**Document Version**: 1.0  
**Last Updated**: 2025-01-04  
**Owner**: @laynepenney