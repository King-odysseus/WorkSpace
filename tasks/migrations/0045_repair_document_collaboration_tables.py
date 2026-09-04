from django.db import migrations


def create_missing_document_tables(apps, schema_editor):
    existing = set(schema_editor.connection.introspection.table_names())
    for name in ('WorkspaceDocumentShare', 'WorkspaceDocumentComment', 'WorkspaceDocumentRevision'):
        model = apps.get_model('tasks', name)
        if model._meta.db_table not in existing:
            schema_editor.create_model(model)


class Migration(migrations.Migration):
    dependencies = [('tasks', '0044_workspace_document_collaboration')]
    operations = [migrations.RunPython(create_missing_document_tables, migrations.RunPython.noop)]
