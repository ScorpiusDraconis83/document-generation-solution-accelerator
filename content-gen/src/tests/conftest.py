"""
Pytest configuration for Content Generation backend tests.

Adds content-gen/src/backend to sys.path so that imports like
``from services.title_service import TitleService`` resolve correctly
when pytest is invoked by the CI workflow from the repo root:

    pytest ./content-gen/src/tests
"""

import sys
import os
import asyncio

# ---- environment setup (BEFORE any backend imports) -----------------------
# The settings module reads env-vars at import time via pydantic-settings.
# Set minimal dummy values so that the module can be imported in CI where
# no .env file or Azure resources exist.
os.environ.setdefault("AZURE_OPENAI_ENDPOINT", "https://test.openai.azure.com")
os.environ.setdefault("AZURE_OPENAI_RESOURCE", "test-resource")
os.environ.setdefault("AZURE_COSMOS_ENDPOINT", "https://test.documents.azure.com:443/")
os.environ.setdefault("AZURE_COSMOSDB_DATABASE", "test-db")
os.environ.setdefault("AZURE_COSMOSDB_ACCOUNT", "test-account")
os.environ.setdefault("AZURE_COSMOSDB_CONVERSATIONS_CONTAINER", "conversations")
os.environ.setdefault("DOTENV_PATH", "")   # prevent reading a real .env file

import pytest  # noqa: E402  (must come after env setup)

# ---- path setup ----------------------------------------------------------
# The backend package lives at  <repo>/content-gen/src/backend.
# We add  <repo>/content-gen/src/backend  so that ``import settings``,
# ``import services.…``, ``import models``, etc. resolve correctly.
_THIS_DIR = os.path.dirname(os.path.abspath(__file__))
_SRC_DIR = os.path.dirname(_THIS_DIR)          # content-gen/src
_BACKEND_DIR = os.path.join(_SRC_DIR, "backend")  # content-gen/src/backend

for _p in (_SRC_DIR, _BACKEND_DIR):
    if _p not in sys.path:
        sys.path.insert(0, _p)


# ---- fixtures -------------------------------------------------------------

@pytest.fixture(scope="session")
def event_loop():
    """Create an instance of the default event loop for each test session."""
    loop = asyncio.get_event_loop_policy().new_event_loop()
    yield loop
    loop.close()


@pytest.fixture
def sample_creative_brief():
    """Sample creative brief for testing."""
    return {
        "overview": "Summer Sale 2024 Campaign",
        "objectives": "Increase online sales by 25% during the summer season",
        "target_audience": "Young professionals aged 25-40 interested in premium electronics",
        "key_message": "Experience premium quality at unbeatable summer prices",
        "tone_and_style": "Upbeat, modern, and aspirational",
        "deliverable": "Social media carousel posts and email banners",
        "timelines": "Campaign runs June 1 - August 31, 2024",
        "visual_guidelines": "Use bright summer colors, outdoor settings, lifestyle imagery",
        "cta": "Shop Now",
    }


@pytest.fixture
def sample_product():
    """Sample product for testing."""
    return {
        "product_name": "ProMax Wireless Headphones",
        "category": "Electronics",
        "sub_category": "Audio",
        "marketing_description": "Immerse yourself in crystal-clear sound with our flagship wireless headphones.",
        "detailed_spec_description": "40mm custom drivers, Active Noise Cancellation, 30-hour battery life, Bluetooth 5.2, USB-C fast charging",
        "sku": "PM-WH-001",
        "model": "ProMax-2024",
        "image_url": "https://example.com/images/headphones.jpg",
        "image_description": "Sleek over-ear headphones in matte black with silver accents",
    }
