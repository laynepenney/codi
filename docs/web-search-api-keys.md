# Web Search API Keys Guide

This guide explains how to obtain API keys for the Enhanced Web Search functionality in Codi.

## Overview

Codi's Enhanced Web Search supports multiple search engines:

- **Brave Search** (recommended) - Generous free tier, privacy-focused
- **Google Custom Search** - 100 free queries/day, then paid
- **Bing Search** - 1000 free queries/month, then paid
- **DuckDuckGo** - Always available as fallback (no API key needed)

## Step-by-Step Instructions

### Brave Search API Key

1. **Visit**: https://brave.com/search/api/
2. **Sign up** for a Brave Search Developer account
3. **Create** a new API key
4. **Copy** the Subscription Token
5. **Add** to your `.env` file:
   ```bash
   BRAVE_SEARCH_API_KEY=your-subscription-token-here
   ```

**Why Brave is recommended:**
- Generous free tier (no specific limit announced)
- Privacy-focused and ad-free
- High-quality, independent search results
- Fast and reliable API

### Google Custom Search API

You need two values for Google:

#### 1. Google Custom Search API Key

1. **Visit**: https://console.cloud.google.com/
2. **Create** or select a project
3. **Enable** the "Custom Search JSON API"
4. **Create credentials** → API key
5. **Copy** the API key

#### 2. Google Custom Search Engine ID

1. **Visit**: https://cse.google.com/create/new
2. **Create** a search engine
3. **Choose** "Search the entire web" or specific sites
4. **Get** the Search Engine ID from your control panel
5. **Add** both to your `.env` file:
   ```bash
   GOOGLE_SEARCH_API_KEY=your-google-api-key
   GOOGLE_SEARCH_ENGINE_ID=your-search-engine-id
   ```

**Important**: Google allows 100 free searches per day.

### Bing Search API Key

1. **Visit**: https://www.microsoft.com/en-us/bing/apis
2. **Sign in** with Microsoft account
3. **Create** a Bing Search API resource
4. **Copy** the Subscription Key
5. **Add** to your `.env` file:
   ```bash
   BING_SEARCH_API_KEY=your-bing-subscription-key
   ```

**Note**: Bing provides 1000 free queries per month.

## Configuration Priority

Codi uses engines in this priority order:

1. **Brave** (if `BRAVE_SEARCH_API_KEY` exists)
2. **Google** (if `GOOGLE_SEARCH_API_KEY` exists)
3. **Bing** (if `BING_SEARCH_API_KEY` exists)
4. **DuckDuckGo** (always available)

If multiple API keys exist, Codi will use the first available working engine.

## Usage Examples

### Minimum Setup (Recommended)
Add only Brave Search API key:
```bash
BRAVE_SEARCH_API_KEY=your-brave-api-key
```

### Multiple Engines Setup
Add all keys for maximum reliability:
```bash
BRAVE_SEARCH_API_KEY=your-brave-api-key
GOOGLE_SEARCH_API_KEY=your-google-api-key
GOOGLE_SEARCH_ENGINE_ID=your-search-engine-id
BING_SEARCH_API_KEY=your-bing-api-key
```

### Fallback Only Setup
If you don't want to use API keys:
```bash
# No web search API keys needed
# Codi will use DuckDuckGo as fallback
```

## Testing Your Setup

1. **Start Codi** with your environment:
   ```bash
   source .env
   codi
   ```

2. **Test web search**:
   ```
   /web_search "test query"
   ```

3. **Monitor** which engine is being used:
   - Check console output for "Successfully used X engine"
   - Results will show engine name: `[Brave]`, `[Google]`, etc.

## Troubleshooting

### "API key required" error
- Check if API key is correctly set in `.env`
- Ensure `.env` is loaded (`source .env`)
- Verify API key format (no quotes or extra spaces)

### Rate limiting
- Codi automatically falls back to next available engine
- Consider adding multiple API keys
- Monitor usage through provider dashboards

### "No results found"
- All engines may be experiencing issues
- Check internet connectivity
- Try DuckDuckGo fallback (no API key needed)

## Cost Considerations

| Provider | Free Tier | Paid Pricing | Best For |
|---------|-----------|--------------|----------|
| **Brave** | Generous free tier | Contact sales | Most users |
| **Google** | 100 queries/day | $5 per 1000 queries | High-volume (paid) |
| **Bing** | 1000 queries/month | $7 per 1000 queries | Backup option |
| **DuckDuckGo** | Unlimited | Free | Fallback only |

For most users, **Brave Search** provides the best balance of quality, privacy, and cost.

## Security Notes

- API keys are only used for web searches
- No sensitive data is sent to search providers
- Keys are stored locally in `.env` file
- Consider using `.env.local` for production (not tracked in git)