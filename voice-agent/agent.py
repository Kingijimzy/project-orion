import json
import os

from dotenv import load_dotenv
from livekit import agents
from livekit.agents import Agent, AgentServer, AgentSession, inference

load_dotenv(".env.local")

VOICE_INSTRUCTIONS = """
You are Orion, a calm, careful voice companion inside a personal trading workspace.
Speak naturally and concisely. Explain SMC, liquidity, risk concepts, and trading plans in beginner-friendly language.
Never invent live prices, candle levels, economic releases, or market data. This voice-agent phase has no market-data tools;
tell the user to open Orion's Market or SMC Scanner page when they need verified current readings.
Discuss scenarios and invalidation conditions, not guaranteed predictions. Never execute trades or request exchange credentials.
When uncertain, say so. This is educational analysis, not a promise of profit.
"""

server = AgentServer()


def _user_context(ctx: agents.JobContext) -> str:
    """Read the same starting context the web app passes to text chat.

    The token endpoint attaches the signed-in user's selected strategy profile as
    participant metadata. Only non-secret labels are present; prices and levels still
    come from Orion's deterministic engine, never from the model.
    """
    metadata = None
    for participant in ctx.room.remote_participants.values():
        if participant.metadata:
            metadata = participant.metadata
            break
    if not metadata:
        return ""
    try:
        parsed = json.loads(metadata)
    except (TypeError, ValueError):
        return ""
    strategy = parsed.get("strategy") if isinstance(parsed, dict) else None
    if isinstance(strategy, dict) and strategy.get("name"):
        version = strategy.get("version")
        label = str(strategy["name"]) + (f" v{version}" if version is not None else "")
        return (
            f'\nThe user has selected the "{label}" strategy profile. Frame the discussion '
            "around that profile's rules, but still never invent prices, levels, or market data."
        )
    return ""


class OrionVoiceAssistant(Agent):
    def __init__(self, extra_instructions: str = "") -> None:
        super().__init__(instructions=VOICE_INSTRUCTIONS + extra_instructions)


@server.rtc_session(agent_name=os.getenv("LIVEKIT_AGENT_NAME", "orion-voice-agent"))
async def orion_voice_agent(ctx: agents.JobContext):
    session = AgentSession(
        llm=inference.RealtimeModel(
            model=os.getenv("LIVEKIT_REALTIME_MODEL", "openai/gpt-realtime-2.1"),
            voice=os.getenv("LIVEKIT_VOICE", "marin"),
        )
    )
    await session.start(room=ctx.room, agent=OrionVoiceAssistant(_user_context(ctx)))
    await session.generate_reply(
        instructions="Greet the user as Orion. Explain briefly that you can discuss trading concepts, but live market data is not connected to this voice session yet."
    )


if __name__ == "__main__":
    agents.cli.run_app(server)
