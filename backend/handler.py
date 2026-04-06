"""
AWS Lambda entrypoint.

Mangum wraps the FastAPI ASGI app so AWS Lambda can invoke it directly.
The Lambda function URL (or API Gateway) forwards HTTP events to this handler.
"""

from mangum import Mangum
from main import app

handler = Mangum(app, lifespan="off")
