"""Builds proposal/omulimu-proposal.pdf. Run: python3 proposal/build_pdf.py"""
from pathlib import Path
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle, KeepTogether

OUT = Path(__file__).with_name("omulimu-proposal.pdf")
INK, MUTED, ACCENT, RULE, TINT = (colors.HexColor(c) for c in ("#1d2430", "#5b6472", "#0f766e", "#d9dee5", "#eef6f5"))

h1 = ParagraphStyle("h1", fontName="Helvetica-Bold", fontSize=19, leading=23, textColor=INK)
sub = ParagraphStyle("sub", fontName="Helvetica", fontSize=10, leading=14, textColor=MUTED)
h2 = ParagraphStyle("h2", fontName="Helvetica-Bold", fontSize=12, leading=15, textColor=ACCENT, spaceBefore=9, spaceAfter=4)
body = ParagraphStyle("body", fontName="Helvetica", fontSize=9.5, leading=13.5, textColor=INK)
cell = ParagraphStyle("cell", parent=body, fontSize=9, leading=12)
cellb = ParagraphStyle("cellb", parent=cell, fontName="Helvetica-Bold")
mono = ParagraphStyle("mono", parent=cell, fontName="Courier", fontSize=8.3, leading=11.5)
note = ParagraphStyle("note", parent=body, fontSize=8.3, leading=11.5, textColor=MUTED)

def P(t, s=cell): return Paragraph(t, s)

def table(rows, widths, header=True):
    t = Table([[c if not isinstance(c, str) else P(c, cellb if (header and i == 0) else cell) for c in r]
               for i, r in enumerate(rows)], colWidths=widths)
    style = [("VALIGN", (0, 0), (-1, -1), "TOP"),
             ("LINEBELOW", (0, 0), (-1, -1), 0.4, RULE),
             ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
             ("LEFTPADDING", (0, 0), (-1, -1), 5), ("RIGHTPADDING", (0, 0), (-1, -1), 5)]
    if header:
        style += [("BACKGROUND", (0, 0), (-1, 0), TINT), ("LINEBELOW", (0, 0), (-1, 0), 0.8, ACCENT)]
    t.setStyle(TableStyle(style))
    return t

W = A4[0] - 36 * mm
story = [
    P("Omulimu: Telegram coaching bot in n8n", h1),
    P("Test project proposal &nbsp;·&nbsp; Kushal Khare, Backend &amp; AI Automation &nbsp;·&nbsp; $60 fixed, 48 hours", sub),
    Spacer(1, 8),

    P("1. Try it now", h2),
    table([
        ["Telegram bot", '<link href="https://t.me/kushal_coaching_bot" color="#0f766e">t.me/kushal_coaching_bot</link>'],
        ["n8n editor", '<link href="https://omulimu-n8n.onrender.com/" color="#0f766e">omulimu-n8n.onrender.com</link>'
                       '&nbsp;&nbsp;·&nbsp;&nbsp;Email <font name="Courier">admin@test.com</font>'
                       '&nbsp;&nbsp;·&nbsp;&nbsp;Password <font name="Courier">Password@123</font>'],
        ["Messages to try", '"sold 120k, spent 40k" &nbsp;·&nbsp; "how do I price my chapati?" &nbsp;·&nbsp; '
                            '"I feel so stressed" &nbsp;·&nbsp; <font name="Courier">/help</font> &nbsp;·&nbsp; a sticker'],
    ], [32 * mm, W - 32 * mm], header=False),

    P("2. How a message flows", h2),
    P("Telegram Trigger &#8594; Save to <b>messages</b> (ON CONFLICT DO NOTHING) &#8594; LLM classifier (last 15 messages)<br/>"
      "&#8594; Router (open session + wellbeing-first rule) &#8594; Numbers | Coach | Care | Help brain<br/>"
      "&#8594; <b>Send Reply</b> sub-workflow (claims the outbound row, 60-word cap, retry on 429) &#8594; Telegram<br/>"
      "LLM fails 3 times &#8594; error branch: fallback reply, <b>error_log</b> row, message marked failed<br/>"
      "Anything unhandled &#8594; Error Trigger workflow &#8594; alert in the admin chat", mono),

    P("3. Technology", h2),
    table([
        ["Layer", "Choice", "Why"],
        ["Orchestration", "n8n 1.123 (self-hosted, Docker)", "7 workflows: a router, 4 brains, Send Reply and the error alert. They are versioned JSON with fixed IDs, so imports overwrite in place."],
        ["Intent classifier", "gpt-4o-mini via OpenRouter, temperature 0, JSON mode", "Returns one of 4 intents plus the amounts and language. The output is checked against a schema and repaired once if invalid. An OpenAI Decisions API mode is optional."],
        ["Brains", "Numbers: plain code<br/>Coach: LLM, max 60 words<br/>Care: fixed templates<br/>Help: menu", "Only the Coach writes free text. Numbers and Care use no LLM, so their sums and safety wording can't drift."],
        ["Database", "Postgres (Supabase), 6 tables", "Unique Telegram update id = no duplicates. The schema has users, messages, sessions, routing_history, daily_records and error_log, and is safe to re-run."],
        ["Hosting", "Render web service (always on)", "Keeps the webhook live and survives restarts: all n8n state lives in Postgres, and secrets live in environment variables, not in the exports."],
        ["Quality", "24 unit tests, 55-check end-to-end suite", "Covers duplicates, parallel updates, LLM failure, a 429 from Telegram, the word cap, buttons and the Care session."],
    ], [27 * mm, 50 * mm, W - 77 * mm]),
]

cost = [
    P("4. Costing", h2),
    P("<b>Project fee</b>", body), Spacer(1, 3),
    table([
        ["Item", "Price"],
        ["Build, test and hand over: n8n export (7 workflows), schema.sql, prompts and templates, setup README, test walkthrough", "$60 fixed"],
        ["Delivery", "Within 48 hours of the contract starting"],
        ["Fixes for anything that fails the acceptance tests in your brief", "Included"],
    ], [W - 40 * mm, 40 * mm]),
    Spacer(1, 8),
    P("<b>Running cost after handover</b> (what you pay the providers each month)", body), Spacer(1, 3),
    table([
        ["Service", "Plan", "Monthly"],
        ["Render (n8n host)", "Starter. The free plan sleeps and misses Telegram messages.", "$7"],
        ["Supabase (Postgres)", "Free tier", "$0"],
        ["Telegram Bot API", "No charge", "$0"],
        ["LLM (gpt-4o-mini)", "Pay per use, about $0.30 to $0.60 per 1,000 messages", "under $1 at pilot volume"],
        [P("<b>Total</b>", cellb), "", P("<b>about $8 / month</b>", cellb)],
    ], [38 * mm, W - 78 * mm, 40 * mm]),
    Spacer(1, 4),
    P("The LLM figure is an estimate: about 1,500 input and 100 output tokens per classification, plus one Coach call "
      "for business questions. OpenRouter's dashboard shows the real spend per day. "
      "Already on a VPS? The same Docker setup runs there, and Render isn't needed.", note),
]

rest = [
    P("5. What you receive", h2),
    P("&#8226; The n8n workflow export (JSON, no secrets inside) and a credentials template<br/>"
      "&#8226; <b>schema.sql</b> for an empty Postgres, and <b>prompts.md</b> with the classifier prompt, Coach prompt and every reply template<br/>"
      "&#8226; A README with setup steps, how to add a fifth intent, known limits, and open questions for you<br/>"
      "&#8226; Test results for your acceptance tests, plus SQL checks you can run yourself", body),
    Spacer(1, 10),
    P("Kushal Khare &nbsp;·&nbsp; github.com/kushal-khare-official &nbsp;·&nbsp; 1st place, Paysafe AI Hackathon 2024", note),
]

story += [KeepTogether(cost)] + rest

SimpleDocTemplate(str(OUT), pagesize=A4, leftMargin=18 * mm, rightMargin=18 * mm,
                  topMargin=16 * mm, bottomMargin=16 * mm,
                  title="Omulimu: Telegram coaching bot in n8n", author="Kushal Khare").build(story)
print(OUT)
