import { HttpClient, HttpContext } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { JP_API_CONFIG, SKIP_LOADER } from 'jp-shared/core';
import { ApiResponse, VerifyDocumentBody } from 'jp-shared/models';
import { Observable } from 'rxjs';

/**
 * Request documents.
 *
 * ----------------------------------------------------------------------------
 * 🔴 WHY A BLOB AND NOT AN `<img src>`
 * ----------------------------------------------------------------------------
 * Uploaded files are stored under generated names outside any statically served
 * folder, and the only route to one is GET /api/documents/{id}, which checks
 * entitlement (a caller who is not entitled gets 404, not 403 — confirming that
 * a document exists is itself a disclosure).
 *
 * That endpoint needs the Authorization header, and a browser does not send one
 * for an `<img>` or an `<iframe>`. So the file is fetched with HttpClient —
 * where the auth interceptor applies — and handed to the element as an object
 * URL instead.
 *
 * ⚠️ Every object URL created from these blobs must be revoked. A reviewer
 * works through fifty requests in a sitting, and fifty un-revoked multi-megabyte
 * blobs is a tab that grinds to a halt with no obvious cause.
 */
@Injectable({ providedIn: 'root' })
export class DocumentService {
  private readonly api = inject(JP_API_CONFIG);
  private readonly http = inject(HttpClient);

  private readonly baseUrl = `${this.api.appApiUrl}/documents`;

  /**
   * Fetches the file itself, through the access check.
   *
   * ⚠️ Deliberately out of the global spinner. A reviewer clicks through five
   * documents on one request, and blacking out the whole screen each time —
   * including the form they are reading the document against — makes the
   * viewer feel worse than downloading. The viewer shows its own
   * content-shaped loading state in the panel that is actually changing.
   */
  download(documentId: number): Observable<Blob> {
    return this.http.get(`${this.baseUrl}/${documentId}`, {
      responseType: 'blob',
      context: new HttpContext().set(SKIP_LOADER, true),
    });
  }

  /** Marks one document verified or rejected. Requires the verification permission. */
  verify(documentId: number, body: VerifyDocumentBody): Observable<ApiResponse<unknown>> {
    return this.http.post<ApiResponse<unknown>>(`${this.baseUrl}/${documentId}/verify`, body);
  }
}
