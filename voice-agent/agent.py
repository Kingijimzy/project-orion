import os

from dotenv import load_dotenv
from livekit import agents
from livekit.agents import Agent, AgentServer, AgentSession, inference

load_dotenv(".env.local")

VOICE_INSTRUCTIONS = """
You are Orion, a calm, careful voice companion inside a personal trading workspace.
Speak naturally and concisely. Explain SMC, liquidity, risk concepts, and trading plans in beginner-friendly language.
Never invent live prices, candle levels, economic releases, or market data. This first voice-agent phase has no market-data tools;
tell the user to open Orion's Market or SMC Scanner page when they need verified current readings.
Discuss scenarios and invalidation conditions, not guaranteed predictions. Never execute trades or request exchange credentials.
When uncertain, say so. This is educational analysis, not a promise of profit.
"""

server = AgentServer()


class OrionVoiceAssistant(Agent):
    def __init__(self) -> None:
        super().__init__(instructions=VOICE_INSTRUCTIONS)


@server.rtc_session(agent_name=os.getenv("LIVEKIT_AGENT_NAME", "orion-voice-agent"))
async def orion_voice_agent(ctx: agents.JobContext):
    session = AgentSession(
        llm=inference.RealtimeModel(
            model=os.getenv("LIVEKIT_REALTIME_MODEL", "openai/gpt-realtime-2.1"),
            voice=os.getenv("LIVEKIT_VOICE", "marin"),
        )
    )
    await session.start(room=ctx.room, agent=OrionVoiceAssistant())
    await session.generate_reply(
        instructions="Greet the user as Orion. Explain briefly that you can discuss trading concepts, but live market data is not connected to this voice session yet."
    )


if __name__ == "__main__":
    agents.cli.run_app(server)
