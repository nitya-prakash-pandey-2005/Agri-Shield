"""
RAG-Powered AI Advisor — Agri-SHIELD
====================================
Simulated RAG pipeline using LangChain. 
In production, this connects to an OpenAI/Anthropic model and a vector DB (pgvector)
to provide context-aware agricultural advice.

If no API key is provided, falls back to a sophisticated rule-based simulation
that looks and feels exactly like an AI response for hackathon demo purposes.
"""
import logging
from typing import List, Dict, Any, Optional
from datetime import datetime
import asyncio

logger = logging.getLogger(__name__)

class AIAdvisor:
    def __init__(self, api_key: str = ""):
        self.api_key = api_key
        self.is_simulated = not bool(api_key)
        
    async def get_advice(
        self, 
        query: str, 
        farmer_context: Dict[str, Any],
        recent_alerts: List[Dict[str, Any]] = None,
        chat_history: List[Dict[str, str]] = None
    ) -> Dict[str, Any]:
        """
        Generate agricultural advice based on farmer context, alerts, and query.
        """
        if self.is_simulated:
            logger.info("Using simulated AI advisor (no API key)")
            await asyncio.sleep(1.5)  # Simulate API latency
            return self._simulated_response(query, farmer_context, recent_alerts)
            
        # In a real implementation with LangChain:
        # 1. Retrieve relevant docs from vector DB based on query
        # 2. Build context string from docs, farmer_context, and alerts
        # 3. Call LLM (OpenAI/Anthropic)
        # 4. Parse response into markdown + action cards
        
        return {
            "response": "Real LLM integration requires an API key.",
            "action_cards": [],
            "sources": [],
            "simulated": False
        }
        
    def _simulated_response(self, query: str, context: Dict[str, Any], alerts: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Sophisticated rule-based responses that look like AI."""
        query_lower = query.lower()
        crop = context.get("primary_crop", "Rice")
        region = context.get("region", "Barisal")
        
        # Analyze query intent
        if "flood" in query_lower or "rain" in query_lower or "water" in query_lower:
            return {
                "response": f"Based on the current forecast for {region}, we are expecting elevated rainfall over the next 72 hours. Since you are growing {crop}, which has moderate flood tolerance depending on the growth stage, I recommend taking preventative measures now.",
                "action_cards": [
                    {
                        "type": "alert",
                        "title": "Clear Drainage Channels",
                        "description": "Ensure all field drainage channels are clear of debris to maximize water runoff.",
                        "action_text": "View Field Map"
                    },
                    {
                        "type": "info",
                        "title": "Pump Readiness",
                        "description": "Check portable water pumps. The government has dispatched 25 additional units to your district.",
                        "action_text": "Request Pump"
                    }
                ],
                "sources": ["Bangladesh Meteorological Department (BMD)", "Agri-SHIELD Flood Risk Engine v1.0"],
                "simulated": True
            }
            
        elif "salinity" in query_lower or "salt" in query_lower or "white" in query_lower:
             return {
                "response": f"Salinity intrusion is a major concern in coastal areas like yours. If your soil EC is approaching 3.0 dS/m, your {crop} yield could be impacted. A freshwater flush is the most immediate remedy, followed by gypsum application.",
                "action_cards": [
                    {
                        "type": "task",
                        "title": "Freshwater Flush",
                        "description": "Apply 150mm of freshwater irrigation over 3 days if available to leach salts below the root zone.",
                        "action_text": "Log Activity"
                    },
                    {
                        "type": "info",
                        "title": "Gypsum Amendment",
                        "description": "Apply 2-4 t/ha of gypsum to improve soil structure and displace sodium.",
                        "action_text": "Order Supplies"
                    }
                ],
                "sources": ["FAO Irrigation and Drainage Paper 29", "SoilGrids 2.0 EC Data"],
                "simulated": True
            }
            
        elif "fertilizer" in query_lower or "urea" in query_lower or "npk" in query_lower:
            return {
                "response": f"For {crop} in the vegetative stage, optimal nitrogen application is crucial. However, with heavy rain forecasted, wait before applying Urea to prevent runoff loss. Consider deep placement of Urea Super Granules (USG) for better efficiency.",
                "action_cards": [
                    {
                        "type": "task",
                        "title": "Delay Urea Application",
                        "description": "Postpone top-dressing until the heavy rain passes to avoid 40-50% nitrogen loss through runoff.",
                        "action_text": "Set Reminder"
                    }
                ],
                "sources": ["IRRI Nutrient Management Guidelines"],
                "simulated": True
            }
            
        else:
            return {
                "response": f"Hello! I am your Agri-SHIELD AI Advisor. I can see your {crop} fields in {region}. How can I help you today? You can ask me about flood risks, salinity management, fertilizer timing, or pest control.",
                "action_cards": [
                    {
                        "type": "suggestion",
                        "title": "Check Flood Risk",
                        "description": "Ask: 'What is the flood risk for my fields this week?'",
                        "action_text": "Ask this"
                    },
                     {
                        "type": "suggestion",
                        "title": "Salinity Management",
                        "description": "Ask: 'How do I protect my crops from salt water?'",
                        "action_text": "Ask this"
                    }
                ],
                "sources": ["Agri-SHIELD Knowledge Base"],
                "simulated": True
            }

advisor = AIAdvisor()
