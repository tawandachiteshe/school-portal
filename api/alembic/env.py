from logging.config import fileConfig

from sqlalchemy import create_engine

from alembic import context
from app.config import get_settings

config = context.config
if config.config_file_name:
    fileConfig(config.config_file_name)

# The ORM models cover only what the API uses; migrations are written by hand
# to match docs/database/schema.sql, so no autogenerate target metadata.
target_metadata = None


def run_migrations_online() -> None:
    url = config.get_main_option("sqlalchemy.url") or get_settings().database_url
    engine = create_engine(url)
    with engine.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata, transactional_ddl=True)
        with context.begin_transaction():
            context.run_migrations()


run_migrations_online()
