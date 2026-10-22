import os

import uvicorn

if __name__ == "__main__":
    uvicorn.run(
        "newteam.api:app",
        host=os.getenv("NEWTEAM_HOST", "127.0.0.1"),
        port=int(os.getenv("NEWTEAM_PORT", "8000")),
    )
