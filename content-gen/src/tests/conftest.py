"""
Pytest configuration and fixtures for backend tests.

This module provides reusable fixtures for testing:
- Mock Azure services (CosmosDB, Blob Storage, OpenAI)
- Test Quart app instance
- Sample test data
"""

import asyncio
import os
import sys
from datetime import datetime, timezone
from typing import AsyncGenerator

import pytest
from quart import Quart

# Set environment variables BEFORE any backend imports
# This prevents settings.py from failing during import
os.environ.update({
    # Base settings
    "AZURE_OPENAI_ENDPOINT": "https://test-openai.openai.azure.com/",
    "AZURE_OPENAI_API_VERSION": "2024-08-01-preview",
    "AZURE_OPENAI_CHAT_DEPLOYMENT": "gpt-4o",
    "AZURE_OPENAI_EMBEDDING_DEPLOYMENT": "text-embedding-3-large",
    "AZURE_OPENAI_DALLE_DEPLOYMENT": "dall-e-3",
    "AZURE_CLIENT_ID": "test-client-id",

    # Cosmos DB
    "AZURE_COSMOSDB_ENDPOINT": "https://test-cosmos.documents.azure.com:443/",
    "AZURE_COSMOSDB_DATABASE_NAME": "test-db",
    "AZURE_COSMOSDB_PRODUCTS_CONTAINER": "products",
    "AZURE_COSMOSDB_CONVERSATIONS_CONTAINER": "conversations",

    # Blob Storage
    "AZURE_STORAGE_ACCOUNT_NAME": "teststorage",
    "AZURE_STORAGE_CONTAINER": "test-container",
    "AZURE_STORAGE_ACCOUNT_URL": "https://teststorage.blob.core.windows.net",
    "AZURE_BLOB_PRODUCT_IMAGES_CONTAINER": "product-images",
    "AZURE_BLOB_GENERATED_IMAGES_CONTAINER": "generated-images",

    # Content Safety
    "AZURE_CONTENT_SAFETY_ENDPOINT": "https://test-safety.cognitiveservices.azure.com/",
    "AZURE_CONTENT_SAFETY_API_VERSION": "2024-09-01",

    # Search Service
    "AZURE_SEARCH_ENDPOINT": "https://test-search.search.windows.net",
    "AZURE_SEARCH_INDEX_NAME": "products-index",

    # Foundry (optional)
    "USE_FOUNDRY": "false",
    "AZURE_AI_PROJECT_CONNECTION_STRING": "",

    # Admin - Empty for development mode (no authentication required)
    "ADMIN_API_KEY": "",

    # App Configuration
    "ALLOWED_ORIGIN": "http://localhost:3000",
    "LOG_LEVEL": "DEBUG",
})

# Add the backend directory to the Python path so we can import backend modules
tests_dir = os.path.dirname(os.path.abspath(__file__))
backend_dir = os.path.join(os.path.dirname(tests_dir), 'backend')
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

# Set Windows event loop policy at module level (fixes pytest-asyncio auto mode compatibility)
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())


# ==================== Environment Configuration ====================

@pytest.fixture(scope="function", autouse=True)
def mock_environment():
    """Ensure environment variables are set for each test."""
    # Environment variables are already set at module level
    # This fixture exists for potential test-specific overrides
    yield


# ==================== App Fixtures ====================

@pytest.fixture
async def app() -> AsyncGenerator[Quart, None]:
    """Create a test Quart app instance."""
    # Import here to ensure environment variables are set first
    from app import app as quart_app

    quart_app.config["TESTING"] = True

    yield quart_app


@pytest.fixture
async def client(app: Quart):
    """Create a test client for the Quart app."""
    return app.test_client()


# ==================== Sample Test Data ====================

@pytest.fixture
def sample_product_dict():
    """Sample product data as dictionary."""
    return {
        "id": "CP-0001",
        "product_name": "Snow Veil",
        "description": "A soft, airy white with minimal undertones",
        "tags": "soft white, airy, minimal, clean",
        "price": 45.99,
        "sku": "CP-0001",
        "image_url": "https://test.blob.core.windows.net/images/snow-veil.jpg",
        "category": "Paint",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat()
    }


@pytest.fixture
def sample_product(sample_product_dict):
    """Sample product as Pydantic model."""
    from models import Product
    return Product(**sample_product_dict)


@pytest.fixture
def sample_creative_brief_dict():
    """Sample creative brief data as dictionary."""
    return {
        "overview": "Spring campaign for eco-friendly paint line",
        "objectives": "Increase brand awareness and drive 20% sales growth",
        "target_audience": "Homeowners aged 30-50, environmentally conscious",
        "key_message": "Beautiful colors that care for the planet",
        "tone_and_style": "Warm, optimistic, trustworthy",
        "deliverable": "Social media posts and email campaign",
        "timelines": "Launch March 1, run for 6 weeks",
        "visual_guidelines": "Natural lighting, green spaces, happy families",
        "cta": "Shop Now - Free Shipping"
    }


@pytest.fixture
def sample_creative_brief(sample_creative_brief_dict):
    """Sample creative brief as Pydantic model."""
    from models import CreativeBrief
    return CreativeBrief(**sample_creative_brief_dict)


@pytest.fixture
def authenticated_headers():
    """Headers simulating an authenticated user via EasyAuth."""
    return {
        "X-Ms-Client-Principal-Id": "test-user-123",
        "X-Ms-Client-Principal-Name": "test@example.com",
        "X-Ms-Client-Principal-Idp": "aad"
    }


@pytest.fixture
def admin_headers():
    """Headers with admin API key."""
    return {
        "X-Admin-API-Key": "test-admin-key"
    }
