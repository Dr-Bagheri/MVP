import { coreFetch, errorResponse, readJson } from "@/server/core";

/**
 * The signatures placed on a meeting (db/0229): who signed, and the three
 * facts about the caller the summary tab draws its one control from.
 *
 * POST signs. The body is `{}` for somebody with a signature on file, or
 * carries `image_base64` for somebody filing one in the same act — core
 * decides which, and its refusals come back with their codes
 * (`no_signature_on_file`, `already_signed`) for the tab to say in the
 * reader's language.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    return Response.json(await coreFetch(`/v1/meetings/${encodeURIComponent(id)}/signatures`));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = await readJson(request);
    return Response.json(
      await coreFetch(`/v1/meetings/${encodeURIComponent(id)}/signatures`, { method: "POST", body }),
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
