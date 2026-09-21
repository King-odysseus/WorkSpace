"""Upload, serve and remove a workspace's logo.

One route does all three so the permission rules sit together: any member can
see the logo, only an owner or manager can change it.

The logo follows the same path as a profile photo. It is validated and
re-encoded by image_uploads before it is stored, it gets a durable Cloudinary
copy when one is configured, and it is delivered through a signed URL rather
than a public one. Nothing here hands out a link that outlives the membership
check that produced it.
"""

import logging
import mimetypes

from django.http import HttpResponse, HttpResponseRedirect, JsonResponse
from django.views.decorators.http import require_http_methods

from . import cloud_storage, image_uploads
from .models import Workspace
from .views import require_workspace_leader, require_workspace_member

logger = logging.getLogger(__name__)

# Sizes the logo route will deliver. An allowlist, not a free dimension: each
# distinct size is a Cloudinary transformation that counts against the plan.
DELIVERY_SIZES = {32, 64, 128, 256}
DEFAULT_SIZE = 128


def _requested_size(request):
    try:
        size = int(request.GET.get('size', ''))
    except (TypeError, ValueError):
        return DEFAULT_SIZE
    return size if size in DELIVERY_SIZES else DEFAULT_SIZE


@require_http_methods(['GET', 'POST', 'DELETE'])
def workspace_logo(request, workspace_id):
    membership, error = (
        require_workspace_member(request, workspace_id)
        if request.method == 'GET'
        else require_workspace_leader(request, workspace_id)
    )
    if error:
        return error
    workspace = membership.workspace

    if request.method == 'GET':
        return _serve(request, workspace)
    if request.method == 'DELETE':
        return _remove(workspace)
    return _replace(request, workspace)


def _serve(request, workspace):
    if not (workspace.logo or workspace.cloudinary_asset):
        return JsonResponse({'error': 'This workspace has no logo.'}, status=404)
    if cloud_storage.is_stored(workspace.cloudinary_asset):
        size = _requested_size(request)
        signed = cloud_storage.delivery_url(workspace.cloudinary_asset, transformation={
            'width': size, 'height': size, 'crop': 'fit',
            'quality': 'auto', 'fetch_format': 'auto',
        })
        if signed:
            return HttpResponseRedirect(signed)
    if not workspace.logo:
        return JsonResponse({'error': 'The logo is unavailable.'}, status=404)
    # Read the (small, size-capped) image rather than streaming it: the handle
    # would otherwise outlive the response and block a same-request replace.
    try:
        with workspace.logo.open('rb') as stored:
            content = stored.read()
    except (FileNotFoundError, OSError):
        return JsonResponse({'error': 'The logo is unavailable.'}, status=404)
    response = HttpResponse(content, content_type=mimetypes.guess_type(workspace.logo.name)[0] or 'application/octet-stream')
    response['Cache-Control'] = 'private, max-age=300'
    return response


def _replace(request, workspace):
    uploaded = request.FILES.get('logo')
    if uploaded is None:
        return JsonResponse({'error': 'An image file is required.'}, status=400)
    if uploaded.size > image_uploads.MAX_BYTES:
        return JsonResponse({'error': 'Images must be 5 MB or smaller.'}, status=400)
    invalid = image_uploads.validation_error(uploaded)
    if invalid:
        return JsonResponse({'error': invalid}, status=400)
    normalized = image_uploads.normalized_image(uploaded, name='logo.webp')
    # Drop the old asset first, or it lingers in Cloudinary billing for a file
    # nothing can reach any more.
    cloud_storage.destroy(workspace.cloudinary_asset)
    workspace.logo.delete(save=False)
    workspace.logo = normalized
    workspace.cloudinary_asset = cloud_storage.upload(
        normalized, f'workspace-logos/{workspace.id}',
        resource_type='image', delivery_type=cloud_storage.AUTHENTICATED,
    )
    workspace.save(update_fields=['logo', 'cloudinary_asset'])
    return JsonResponse({'logo_url': workspace.logo_url})


def _remove(workspace):
    cloud_storage.destroy(workspace.cloudinary_asset)
    workspace.logo.delete(save=False)
    workspace.logo = None
    workspace.cloudinary_asset = {}
    workspace.save(update_fields=['logo', 'cloudinary_asset'])
    return JsonResponse({'logo_url': ''})
