import asyncio
from abc import ABC, abstractmethod
from typing import Optional


class BaseAgentFactory(ABC):
    """Base factory class for creating and managing agent instances."""
    _lock = asyncio.Lock()
    _agent: Optional[object] = None

    @classmethod
    async def get_agent(cls) -> object:
        """Get or create an agent instance using singleton pattern."""
        async with cls._lock:
            if cls._agent is None:
                cls._agent = await cls.create_or_get_agent()
        return cls._agent

    @classmethod
    async def delete_agent(cls):
        """Delete the current agent instance."""
        async with cls._lock:
            if cls._agent is not None:
                await cls._delete_agent_instance(cls._agent)
                cls._agent = None

    @classmethod
    @abstractmethod
    async def create_or_get_agent(cls) -> object:
        """Create a new agent instance."""
        pass

    @classmethod
    @abstractmethod
    async def _delete_agent_instance(cls, agent: object):
        """Delete the specified agent instance."""
        pass
