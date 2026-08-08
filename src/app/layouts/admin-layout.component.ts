import { ChangeDetectionStrategy, Component } from '@angular/core';
import { UiAppShellComponent } from 'jp-shared/ui';

/**
 * Admin chrome.
 *
 * Nothing here but the shared shell and this app's section label — the
 * navigation comes from GET /api/menus, which returns only the rows for this
 * user's type (decision 2.37). That is what makes three apps able to share one
 * shell component without any of them knowing about the others' screens.
 */
@Component({
  selector: 'app-admin-layout',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiAppShellComponent],
  template: '<ui-app-shell sectionTitle="Admin" />',
})
export class AdminLayoutComponent {}
