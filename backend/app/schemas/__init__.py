"""Schema package — import all so routers see them in one place."""
from app.schemas.common import *  # noqa: F401,F403
from app.schemas.auth import *  # noqa: F401,F403
from app.schemas.workspace import *  # noqa: F401,F403
from app.schemas.project import *  # noqa: F401,F403
from app.schemas.document import *  # noqa: F401,F403
from app.schemas.knowledge import *  # noqa: F401,F403
from app.schemas.authority import *  # noqa: F401,F403
from app.schemas.handover import *  # noqa: F401,F403
from app.schemas.assistant import *  # noqa: F401,F403
