"""Ask Campus, the student assistant (docs/04), sandboxed:

1. Tools only read. They run on a database connection Postgres keeps read-only (sandbox.py), so a
   write fails even if a tool tried one.
2. Tools only see the asker's own records: who is asking comes from the session, never from the
   model, and no tool takes a person, student number or id as input.
3. No internet and no code: the model gets a fixed list of portal tools and nothing else.
4. College documents reach the model as quoted data in tool results, never as instructions.
5. Each role gets only its tools (an applicant: their application; a student: their records).
6. Rate limits, an answer-length cap, a cap on tool rounds, and ASSISTANT_ENABLED.
7. The model can't send or change anything; handing a question to Student Affairs happens only
   when the student presses the button.
"""
