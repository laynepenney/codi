# Enhanced Web Search

**Status**: 🔄 UNDER REVIEW  
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

1. **DuckDuckGo Lite limitations**: Uses HTML scraping (no official API), which is fragile and unreliable
2. **No pagination**: Limited to 10 results maximum per query
3. **Fragile parsing**: HTML scraping can break with website changes
4. **No filtering**: Can't search specific sites, date ranges, or result types
5. **Frequent failures**: DuckDuckGo rate limiting affects reliability
6. **No caching**: Same searches are performed repeatedly
7. **Limited processing**: Basic link/snippet extraction with no content analysis

### Solution

A multi-engine web search system with:
- Multiple search engine support (DuckDuckGo scraping, Google, Bing, Brave)
- Query optimization and search templates for common use cases
- Robust parsing with automatic fallbacks between engines
- Search caching with TTL-based expiration and size limits
- Domain-specific result processing for technical queries

---

## Goals

- [ ] Improve search reliability and uptime
- [ ] Increase result quality and relevance
- [ ] Add domain-specific search templates (docs, pricing, errors)
- [ ] Implement intelligent caching to reduce API calls
- [ ] Support multiple search engines as fallbacks
- [ ] Extract structured data from search results
- [ ] Handle rate limiting gracefully with circuit breaker pattern

## Non-Goals

- Real-time web crawling or scraping beyond search results
- Full-page content extraction without user consent
- Paid API services that require subscriptions (budget permitting)
- Image or video search capabilities

---

## Background & Context

### Current State
The current web search tool uses DuckDuckGo's lite HTML interface with scraping, returning 5-10 results per query. It handles basic searches but struggles with:
- DuckDuckGo rate limiting
- HTML structure changes breaking parsing
- No advanced search features
- Inconsistent result quality

**Known E2 Limitation**: The current implementation scrapes E2 Lite HTML because DuckDuckGo doesn't offer a free structured JSON API. This is inherently fragile and motivates the multi-engine approach.

### Prior Art
- **SERP APIs**: Commercial services like SerpAPI ($50+/month), Serly for structured results
- **Google Custom Search API**: 100 free queries/day, then paid
- **Brave Search API**: True JSON API with generous free tier, privacy-focused
- **Bing Search API**: 1,000 freequeries/month, then paid

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
4. **Cache Layer**: Persistent storage with size limits and TTL expiration
5. **Quality Scorer**: Result relevance ranking and spam detection

### Architecture

```typescript
┌─────────────────────────────────────────┐
│         EnhancedWebSearchTool            │
├─────────────────────────────────────────┤
│  ┌──── Engine Registry                  │
│  │   ├─ DuckDuckGoEngine (scraping)     │
│  │   ├─ BraveEngine (JSON API)          │
│  │   ├─ GoogleEngine (fallback)         │
│  │   └─ BingEngine (backup)             │
│  │                                        │
│  ├──── Query Optimizer                   │
│  │   ├─ Search templates                 │
│  │   ├─ Domain-specific optimization     │
│  │   └─ Query expansion                  │
│  │                                        │
│  ├──── Result Processor                  │
│  │   ├─ Structured data extraction       │
│  │   ├─ Site-specific parsers            │
│  │   ├─ Content fetching (limited)       │
│  │   └─ Cross-source comparison          │
│  │                                        │
│  ├──── Cache Layer                       │
│  │   ├─ Persistent storage (LRU)         │
│  │   ├─ TTL-based expiration             │
│  │   ├─ Max size limits (1000 entries)   │
│  │   └─ Template-aware TTL               │
│  │                                        │
│  └──── Quality Scorer                    │
│      ├─ Domain authority scoring         │
│      ├─ Content freshness                │
│      ├─ User feedback integration        │
│      └─ Spam detection                   │
└─────────────────────────────────────────┘
```

### Search Templates

Templates transform user queries into optimized search strings:

```typescript
const SEARCH_TEMPLATES: Record<string, SearchTemplate> = {
  docs: {
    sites: ['stackoverflow.com', 'docs.python.org', 'developer.mozilla.org'],
    modifiers: ['syntax', 'example'],
    ttl: 86400, // 24 hours - docs rarely change
  },
  pricing: {
    sites: ['openai.com', 'anthropic.com', 'platform.openai.com'],
    modifiers: ['pricing', 'cost', 'rate'],
    ttl: 604800, // 7 days - pricing changes infrequently
  },
  errors: {
    sites: ['stackoverflow.com', 'github.com', 'reddit.com'],
    modifiers: ['error', 'fix', 'solution'],
    ttl: 43200, // 12 hours - fixes may be found faster
  },
  general: {
    modifiers: [],
    ttl: 3600, // 1 hour - default TTL
  },
};
```

### API/UI Changes

**New Configuration Options** (`.codi.json`):
```json
{
  "webSearch": {
    "engines": ["brave", "google", "bing"],
    "engineOrder": ["brave", "google", "duckduckgo"],
    "cacheEnabled": true,
    "cacheMaxSize": 1000,
    "defaultTTL": 3600,
    "maxResults": 15,
    "templates": {
      "docs": {
        "sites": ["stackoverflow.com", "docs.python.org", "developer.mozilla.org"],
        "sort": "relevance"
      },
      "pricing": {
        "sites": ["openai.com", "anthropic.com"],
        "sort": "date"
      },
      "errors": {
        "sites": ["stackoverflow.com", "github.com"],
        "sort": "relevance"
      }
    }
  }
}
```

**Enhanced Tool Parameters**:
```typescript
interface EnhancedWebSearchInput {
  query: string;
  num_results?: number;           // 1-20, default: 5
  engine?: 'duckduckgo' | 'brave' | 'google' | 'bing';
  template?: 'docs' | 'pricing' | 'errors' | 'general';
  site_filter?: string[];
  date_range?: 'week' | 'month' | 'year' | 'all';  // Only on Google, Bing
  extract_content?: boolean;      // Fetch full page content (limited)
}
```

---

## Implementation Plan

### Phase 1: Multi-Engine Foundation (1 week)
- [ ] Engine registry with plugin interface
- [ ] Brave Search API integration (reliable JSON API, primary)
- [ ] Google Custom Search API fallback (100 free queries/day)
- [ ] Bing Search API backup
- [ ] Engine fallback and retry with circuit breaker
- [ ] Configuration schema and validation
- [ ] LRU cache with size limits (max 1000 entries)

### Phase 2: Enhanced Features (1 week)
- [ ] Search templates system (docs, pricing, errors, general)
- [ ] Template-aware TTL (pricing: 7 days, errors: 12 hours, etc.)
- [ ] Domain-specific parsers (Stack Overflow, GitHub, docs)
- [ ] Enhanced result formatting with relevance scores
- [ ] Rate limiting per-engine handling

### Phase 3: Advanced Capabilities (1 week)
- [ ] Cross-source comparison and aggregation
- [ ] Structured data extraction (pricing tables, API specs)
- [ ] Automatic fact checking and verification
- [ ] Health monitoring and engine status API

**Timeline**: 3 weeks

---

## Alternatives Considered

| Option | Pros | Cons | Decision |
|--------|------|------|----------|
| **SERP Service Integration** | Reliable, structured data | Paid service ($50+/month) | ❌ Too costly by default |
| **Browser Automation (Puppeteer)** | Full JS support, renders pages | Heavy, slow, memory-intensive | ❌ Too resource-intensive |
| **Multiple Free APIs** | No cost, redundancy, reliability | Rate limits per engine | ✅ Selected approach |
| **Enhanced HTML Scraping** | Works today, no API needed | Fragile to website changes | ⚠️ Fallback only |

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Search engine API changes | High | Plugin architecture, automated monitoring |
| Rate limiting (all engines) | High | Circuit breaker, backoff, Brave as primary (generous limits) |
| Third-party API costs | Medium | Free tiers only by default, opt-in for paid |
| Cache unbounded growth | Medium | LRU eviction, max size limit (1000 entries) |
| Feature creep | Medium | Stick to phased implementation plan |
| E3 HTML changes breaking parsing | Medium | Brave JSON API as primary, reduced E3 dependency |

---

## Success Criteria

### Must Have (MVP)
- [ ] Brave Search API integration (reliable JSON API primary)
- [ ] Google Custom Search fallback (100 free queries/day)
- [ ] Engine fallback and retry logic working
- [ ] Search templates for docs, pricing, errors
- [ ] LRU cache with max 1000 entries, TTL expiration

### Should Have
- [ ] Domain-specific result processing
- [ ] Structured data extraction from common sites
- [ ] Quality scoring for result relevance
- [ ] Rate limiting per engine

### Nice to Have
- [ ] Cross-source verification system
- [ ] User feedback for quality improvement
- [ ] Automated engine health monitoring

---

## Testing Strategy

- **Unit tests**: Engine plugins, parsers, caching (LRU eviction)
- **Integration tests**: End-to-end search flows with mocked APIs
- **Manual testing**: Search templates, multi-engine fallbacks
- **Performance testing**:
  - Cache hit rate (target: 40%+ for repeated queries)
  - Memory usage (target: <50MB for cache layer)
  - API response times (target: <2s per search)
- **Failure testing**:
  - Engine failure and fallback behavior
  - Rate limit handling and circuit breaker
  - Cache eviction under pressure

---

## Open Questions

1. Should we add opt-in support for paid APIs (SerpAPI) with cost monitoring for users who need higher limits?
2. What cache TTL is optimal per template type? (Current defaults: pricing 7d, errors 12h, docs 24h, general 1h)
3. Should Brave Search API be the primary engine instead of DuckDuckGo HTML scraping?
4. Should we include limited content extraction (first 5KB) beyond snippet level?

---

## References

- Current implementation: `src/tools/web-search.ts`
- E3 Lite HTML scraping: https://lite.duckduckgo.com/lite/
- Brave Search API: https://brave.com/search/api/ (generous free tier)
- Google Custom Search API: https://developers.google.com/custom-search (100 queries/day free)
- Bing Search API: https://www.microsoft.com/bing/apis (1000 queries/month free)

---

## Revision History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2025-01-04 | Initial proposal |
| 1.1 | 2025-01-04 | Fixed SerpAPI error (paid, not free), added Brave as primary, LRU cache with max size, template-aware TTL, added errors template to config, date_range limitations note, performance testing |

---

**Document Version**: 1.1  
**Last Updated**: 2025-01-04  
**Owner**: @laynepenney