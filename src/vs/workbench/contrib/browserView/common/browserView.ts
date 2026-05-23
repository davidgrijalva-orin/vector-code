/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable, IDisposable } from '../../../../base/common/lifecycle.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { CDPEvent, CDPRequest, CDPResponse } from '../../../../platform/browserView/common/cdp/types.js';
import type { BrowserEditorInput } from './browserEditorInput.js';
import {
	IBrowserViewBounds,
	IBrowserViewNavigationEvent,
	IBrowserViewLoadingEvent,
	IBrowserViewLoadError,
	IBrowserViewFocusEvent,
	IBrowserViewKeyDownEvent,
	IBrowserViewTitleChangeEvent,
	IBrowserViewFaviconChangeEvent,
	IBrowserViewDevToolsStateEvent,
	IBrowserViewService,
	BrowserViewStorageScope,
	IBrowserViewCaptureScreenshotOptions,
	IBrowserViewFindInPageOptions,
	IBrowserViewFindInPageResult,
	IBrowserViewVisibilityEvent,
	IBrowserViewCertificateError,
	IElementData,
	IBrowserViewOwner,
	browserZoomDefaultIndex,
	browserZoomFactors,
	IBrowserViewState
} from '../../../../platform/browserView/common/browserView.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { isLocalhostAuthority } from '../../../../platform/url/common/trustedDomains.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IBrowserZoomService } from './browserZoomService.js';

export const enum BrowserViewSharingState {
	/** Browser automation is available and the page is shared. */
	Shared = 'shared',
	/** Browser automation is available but the page is not shared. */
	NotShared = 'notShared',
	/** Browser automation is disabled. */
	Unavailable = 'unavailable',
}

/** Extracts the host from a URL string for zoom tracking purposes. */
function parseZoomHost(url: string): string | undefined {
	const parsed = URL.parse(url);
	if (!parsed?.host || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) {
		return undefined;
	}
	return parsed.host;
}

type IntegratedBrowserNavigationEvent = {
	navigationType: 'urlInput' | 'goBack' | 'goForward' | 'reload';
	isLocalhost: boolean;
};

type IntegratedBrowserNavigationClassification = {
	navigationType: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'How the navigation was triggered' };
	isLocalhost: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; isMeasurement: true; comment: 'Whether the URL is a localhost address' };
	owner: 'kycutler';
	comment: 'Tracks navigation patterns in integrated browser';
};


type IntegratedBrowserElementSelectionStartEvent = {};

type IntegratedBrowserElementSelectionStartClassification = {
	owner: 'jruales';
	comment: 'The user initiated element selection in Integrated Browser.';
};

/**
 * View state stored in editor options when opening a browser view.
 */
export interface IBrowserEditorViewState {
	readonly url?: string;
	readonly title?: string;
	readonly favicon?: string;

	/**
	 * When true, indicates that this browser tab was opened via the localhost
	 * link opener while the user has not explicitly configured the setting
	 * (i.e. the default value was used). This is a transient flag and is not
	 * serialized.
	 */
	readonly isDefaultLinkOpen?: boolean;
}

export const IBrowserViewWorkbenchService = createDecorator<IBrowserViewWorkbenchService>('browserViewWorkbenchService');

/**
 * Workbench-level service for browser views that provides model-based access to browser views.
 * This service manages browser view models that proxy to the main process browser view service.
 */
export interface IBrowserViewWorkbenchService {
	readonly _serviceBrand: undefined;

	/**
	 * Fires when the set of known browser views changes, or a model is created for an existing input.
	 */
	readonly onDidChangeBrowserViews: Event<void>;

	/**
	 * Whether browser page automation is currently available.
	 */
	readonly isSharingAvailable: boolean;

	/**
	 * Fires when {@link isSharingAvailable} changes.
	 */
	readonly onDidChangeSharingAvailable: Event<boolean>;

	/**
	 * Get all known browser views.
	 */
	getKnownBrowserViews(): Map<string, BrowserEditorInput>;

	/**
	 * Get an existing browser view for the given ID, or create a new one if it doesn't exist.
	 * The underlying browser view is not created until the editor is opened or the model is resolved.
	 */
	getOrCreateLazy(id: string, initialState?: IBrowserEditorViewState): BrowserEditorInput;

	/**
	 * Clear all storage data for the global browser session
	 */
	clearGlobalStorage(): Promise<void>;

	/**
	 * Clear all storage data for the current workspace browser session
	 */
	clearWorkspaceStorage(): Promise<void>;
}

export const IBrowserViewCDPService = createDecorator<IBrowserViewCDPService>('browserViewCDPService');

/**
 * Workbench-level service for managing CDP (Chrome DevTools Protocol) sessions
 * against browser views. Handles group lifecycle and window ID resolution.
 */
export interface IBrowserViewCDPService {
	readonly _serviceBrand: undefined;

	/**
	 * Create a new CDP group for a browser view.
	 * The window ID is resolved from the editor group containing the browser.
	 * @param browserId The browser view identifier.
	 * @returns The ID of the newly created group.
	 */
	createSessionGroup(browserId: string): Promise<string>;

	/** Destroy a CDP group. */
	destroySessionGroup(groupId: string): Promise<void>;

	/** Send a CDP message to a group. */
	sendCDPMessage(groupId: string, message: CDPRequest): Promise<void>;

	/** Fires when a CDP message is received. */
	onCDPMessage(groupId: string): Event<CDPResponse | CDPEvent>;

	/** Fires when a CDP group is destroyed. */
	onDidDestroy(groupId: string): Event<void>;
}


/**
 * A browser view model that represents a single browser view instance in the workbench.
 * This model proxies calls to the main process browser view service using its unique ID.
 */
export interface IBrowserViewModel extends IDisposable {
	readonly id: string;
	readonly owner: IBrowserViewOwner;
	readonly url: string;
	readonly title: string;
	readonly favicon: string | undefined;
	readonly screenshot: VSBuffer | undefined;
	readonly loading: boolean;
	readonly focused: boolean;
	readonly visible: boolean;
	readonly canGoBack: boolean;
	readonly isDevToolsOpen: boolean;
	readonly canGoForward: boolean;
	readonly error: IBrowserViewLoadError | undefined;
	readonly certificateError: IBrowserViewCertificateError | undefined;
	readonly storageScope: BrowserViewStorageScope;
	readonly sharingState: BrowserViewSharingState;
	readonly zoomFactor: number;
	readonly canZoomIn: boolean;
	readonly canZoomOut: boolean;
	readonly isElementSelectionActive: boolean;

	readonly onDidChangeSharingState: Event<BrowserViewSharingState>;
	readonly onDidChangeZoom: Event<void>;
	readonly onDidNavigate: Event<IBrowserViewNavigationEvent>;
	readonly onDidChangeLoadingState: Event<IBrowserViewLoadingEvent>;
	readonly onDidChangeFocus: Event<IBrowserViewFocusEvent>;
	readonly onDidChangeDevToolsState: Event<IBrowserViewDevToolsStateEvent>;
	readonly onDidKeyCommand: Event<IBrowserViewKeyDownEvent>;
	readonly onDidChangeTitle: Event<IBrowserViewTitleChangeEvent>;
	readonly onDidChangeFavicon: Event<IBrowserViewFaviconChangeEvent>;
	readonly onDidFindInPage: Event<IBrowserViewFindInPageResult>;
	readonly onDidChangeVisibility: Event<IBrowserViewVisibilityEvent>;
	readonly onDidClose: Event<void>;
	readonly onWillDispose: Event<void>;
	readonly onDidSelectElement: Event<IElementData>;
	readonly onDidChangeElementSelectionActive: Event<boolean>;

	layout(bounds: IBrowserViewBounds): Promise<void>;
	setVisible(visible: boolean): Promise<void>;
	loadURL(url: string): Promise<void>;
	goBack(): Promise<void>;
	goForward(): Promise<void>;
	reload(hard?: boolean): Promise<void>;
	toggleDevTools(): Promise<void>;
	captureScreenshot(options?: IBrowserViewCaptureScreenshotOptions): Promise<VSBuffer>;
	focus(force?: boolean): Promise<void>;
	findInPage(text: string, options?: IBrowserViewFindInPageOptions): Promise<void>;
	stopFindInPage(keepSelection?: boolean): Promise<void>;
	getSelectedText(): Promise<string>;
	clearStorage(): Promise<void>;
	setSharedWithAgent(shared: boolean): Promise<boolean>;
	trustCertificate(host: string, fingerprint: string): Promise<void>;
	untrustCertificate(host: string, fingerprint: string): Promise<void>;
	zoomIn(): Promise<void>;
	zoomOut(): Promise<void>;
	resetZoom(): Promise<void>;
	getConsoleLogs(): Promise<string>;
	toggleElementSelection(enabled?: boolean): Promise<void>;
}

export class BrowserViewModel extends Disposable implements IBrowserViewModel {
	private _url: string = '';
	private _title: string = '';
	private _favicon: string | undefined = undefined;
	private _screenshot: VSBuffer | undefined = undefined;
	private _loading: boolean = false;
	private _focused: boolean = false;
	private _visible: boolean = false;
	private _isDevToolsOpen: boolean = false;
	private _canGoBack: boolean = false;
	private _canGoForward: boolean = false;
	private _error: IBrowserViewLoadError | undefined = undefined;
	private _certificateError: IBrowserViewCertificateError | undefined = undefined;
	private _storageScope: BrowserViewStorageScope = BrowserViewStorageScope.Ephemeral;
	private _isEphemeral: boolean = false;
	private _zoomHost: string | undefined = undefined;
	private _sharedWithAgent: boolean = false;
	private _browserZoomIndex: number = browserZoomDefaultIndex;
	private _isElementSelectionActive: boolean = false;

	private readonly _onDidChangeSharingState = this._register(new Emitter<BrowserViewSharingState>());
	readonly onDidChangeSharingState: Event<BrowserViewSharingState> = this._onDidChangeSharingState.event;

	private readonly _onDidChangeZoom = this._register(new Emitter<void>());
	readonly onDidChangeZoom: Event<void> = this._onDidChangeZoom.event;

	private readonly _onWillDispose = this._register(new Emitter<void>());
	readonly onWillDispose: Event<void> = this._onWillDispose.event;

	constructor(
		readonly id: string,
		readonly owner: IBrowserViewOwner,
		initialState: IBrowserViewState,
		private readonly browserViewService: IBrowserViewService,
		@IBrowserViewWorkbenchService private readonly browserViewWorkbenchService: IBrowserViewWorkbenchService,
		@ITelemetryService private readonly telemetryService: ITelemetryService,
		@IBrowserZoomService private readonly zoomService: IBrowserZoomService,
		@ILogService private readonly logService: ILogService,
	) {
		super();

		// Initialize state
		this._url = initialState.url;
		this._title = initialState.title;
		this._loading = initialState.loading;
		this._focused = initialState.focused;
		this._visible = initialState.visible;
		this._isDevToolsOpen = initialState.isDevToolsOpen;
		this._canGoBack = initialState.canGoBack;
		this._canGoForward = initialState.canGoForward;
		this._screenshot = initialState.lastScreenshot;
		this._favicon = initialState.lastFavicon;
		this._error = initialState.lastError;
		this._certificateError = initialState.certificateError;
		this._storageScope = initialState.storageScope;
		this._browserZoomIndex = initialState.browserZoomIndex;
		this._isElementSelectionActive = initialState.isElementSelectionActive;
		this._isEphemeral = this._storageScope === BrowserViewStorageScope.Ephemeral;
		this._zoomHost = parseZoomHost(this._url);

		// Sync initial zoom state (async, but emits events)
		const effectiveZoomIndex = this.zoomService.getEffectiveZoomIndex(this._zoomHost, this._isEphemeral);
		if (effectiveZoomIndex !== this._browserZoomIndex) {
			void this.setBrowserZoomIndex(effectiveZoomIndex).catch(e => {
				this.logService.warn(`[BrowserViewModel] Failed to set initial zoom:`, e);
			});
		}

		// Set up state synchronization

		this._register(this.zoomService.onDidChangeZoom(({ host, isEphemeralChange }) => {
			if (isEphemeralChange && !this._isEphemeral) {
				return;
			}
			if (host === undefined || host === this._zoomHost) {
				void this.setBrowserZoomIndex(
					this.zoomService.getEffectiveZoomIndex(this._zoomHost, this._isEphemeral)
				).catch(() => { });
			}
		}));

		this._register(this.onDidNavigate(e => {
			// Clear favicon on navigation to a different host
			if (URL.parse(e.url)?.host !== URL.parse(this._url)?.host) {
				this._favicon = undefined;
			}

			this._zoomHost = parseZoomHost(e.url);
			this._url = e.url;
			this._title = e.title;
			this._canGoBack = e.canGoBack;
			this._canGoForward = e.canGoForward;
			this._certificateError = e.certificateError;

			// Always forceApply because Chromium resets zoom on cross-origin navigation,
			// and an origin change may not correspond to a host change (e.g. http→https).
			void this.setBrowserZoomIndex(
				this.zoomService.getEffectiveZoomIndex(this._zoomHost, this._isEphemeral),
				true
			);
		}));

		this._register(this.onDidChangeLoadingState(e => {
			this._loading = e.loading;
			this._error = e.error;
		}));

		this._register(this.onDidChangeDevToolsState(e => {
			this._isDevToolsOpen = e.isDevToolsOpen;
		}));

		this._register(this.onDidChangeTitle(e => {
			this._title = e.title;
		}));

		this._register(this.onDidChangeFavicon(e => {
			this._favicon = e.favicon;
		}));

		this._register(this.onDidChangeFocus(({ focused }) => {
			this._focused = focused;
		}));

		this._register(this.onDidChangeVisibility(({ visible }) => {
			this._visible = visible;
		}));

		this._register(this.onDidChangeElementSelectionActive(active => {
			if (active) {
				this.telemetryService.publicLog2<IntegratedBrowserElementSelectionStartEvent, IntegratedBrowserElementSelectionStartClassification>('integratedBrowser.elementSelection.start', {});
			}
			this._isElementSelectionActive = active;
		}));

		this._register(this.browserViewWorkbenchService.onDidChangeSharingAvailable(() => {
			this._onDidChangeSharingState.fire(this.sharingState);
		}));
	}

	get url(): string { return this._url; }
	get title(): string { return this._title; }
	get favicon(): string | undefined { return this._favicon; }
	get loading(): boolean { return this._loading; }
	get focused(): boolean { return this._focused; }
	get visible(): boolean { return this._visible; }
	get isDevToolsOpen(): boolean { return this._isDevToolsOpen; }
	get canGoBack(): boolean { return this._canGoBack; }
	get canGoForward(): boolean { return this._canGoForward; }
	get screenshot(): VSBuffer | undefined { return this._screenshot; }
	get error(): IBrowserViewLoadError | undefined { return this._error; }
	get certificateError(): IBrowserViewCertificateError | undefined { return this._certificateError; }
	get storageScope(): BrowserViewStorageScope { return this._storageScope; }
	get sharingState(): BrowserViewSharingState {
		if (!this.browserViewWorkbenchService.isSharingAvailable) {
			return BrowserViewSharingState.Unavailable;
		}
		return this._sharedWithAgent ? BrowserViewSharingState.Shared : BrowserViewSharingState.NotShared;
	}
	get zoomFactor(): number { return browserZoomFactors[this._browserZoomIndex]; }
	get canZoomIn(): boolean { return this._browserZoomIndex < browserZoomFactors.length - 1; }
	get canZoomOut(): boolean { return this._browserZoomIndex > 0; }

	get onDidNavigate(): Event<IBrowserViewNavigationEvent> {
		return this.browserViewService.onDynamicDidNavigate(this.id);
	}

	get onDidChangeLoadingState(): Event<IBrowserViewLoadingEvent> {
		return this.browserViewService.onDynamicDidChangeLoadingState(this.id);
	}

	get onDidChangeFocus(): Event<IBrowserViewFocusEvent> {
		return this.browserViewService.onDynamicDidChangeFocus(this.id);
	}

	get onDidChangeDevToolsState(): Event<IBrowserViewDevToolsStateEvent> {
		return this.browserViewService.onDynamicDidChangeDevToolsState(this.id);
	}

	get onDidKeyCommand(): Event<IBrowserViewKeyDownEvent> {
		return this.browserViewService.onDynamicDidKeyCommand(this.id);
	}

	get onDidChangeTitle(): Event<IBrowserViewTitleChangeEvent> {
		return this.browserViewService.onDynamicDidChangeTitle(this.id);
	}

	get onDidChangeFavicon(): Event<IBrowserViewFaviconChangeEvent> {
		return this.browserViewService.onDynamicDidChangeFavicon(this.id);
	}

	get onDidFindInPage(): Event<IBrowserViewFindInPageResult> {
		return this.browserViewService.onDynamicDidFindInPage(this.id);
	}

	get onDidChangeVisibility(): Event<IBrowserViewVisibilityEvent> {
		return this.browserViewService.onDynamicDidChangeVisibility(this.id);
	}

	get onDidClose(): Event<void> {
		return this.browserViewService.onDynamicDidClose(this.id);
	}

	async layout(bounds: IBrowserViewBounds): Promise<void> {
		return this.browserViewService.layout(this.id, bounds);
	}

	async setVisible(visible: boolean): Promise<void> {
		this._visible = visible; // Set optimistically so model is in sync immediately
		return this.browserViewService.setVisible(this.id, visible);
	}

	async loadURL(url: string): Promise<void> {
		this.logNavigationTelemetry('urlInput', url);
		return this.browserViewService.loadURL(this.id, url);
	}

	async goBack(): Promise<void> {
		this.logNavigationTelemetry('goBack', this._url);
		return this.browserViewService.goBack(this.id);
	}

	async goForward(): Promise<void> {
		this.logNavigationTelemetry('goForward', this._url);
		return this.browserViewService.goForward(this.id);
	}

	async reload(hard?: boolean): Promise<void> {
		this.logNavigationTelemetry('reload', this._url);
		return this.browserViewService.reload(this.id, hard);
	}

	async toggleDevTools(): Promise<void> {
		return this.browserViewService.toggleDevTools(this.id);
	}

	async captureScreenshot(options?: IBrowserViewCaptureScreenshotOptions): Promise<VSBuffer> {
		const result = await this.browserViewService.captureScreenshot(this.id, options);
		// Store full-page screenshots for display in UI as placeholders
		if (!options?.screenRect && !options?.pageRect) {
			this._screenshot = result;
		}
		return result;
	}

	async focus(force?: boolean): Promise<void> {
		return this.browserViewService.focus(this.id, force);
	}

	async findInPage(text: string, options?: IBrowserViewFindInPageOptions): Promise<void> {
		return this.browserViewService.findInPage(this.id, text, options);
	}

	async stopFindInPage(keepSelection?: boolean): Promise<void> {
		return this.browserViewService.stopFindInPage(this.id, keepSelection);
	}

	async getSelectedText(): Promise<string> {
		return this.browserViewService.getSelectedText(this.id);
	}

	async clearStorage(): Promise<void> {
		return this.browserViewService.clearStorage(this.id);
	}

	async trustCertificate(host: string, fingerprint: string): Promise<void> {
		return this.browserViewService.trustCertificate(this.id, host, fingerprint);
	}

	async untrustCertificate(host: string, fingerprint: string): Promise<void> {
		return this.browserViewService.untrustCertificate(this.id, host, fingerprint);
	}

	/**
	 * @param forceApply When true, the IPC call is made even if the local cached zoom index
	 * already matches the requested value. Pass true after cross-document navigation because
	 * Chromium resets the zoom to its per-origin default, making the cache stale.
	 */
	private async setBrowserZoomIndex(zoomIndex: number, forceApply = false): Promise<void> {
		const clamped = Math.max(0, Math.min(zoomIndex, browserZoomFactors.length - 1));
		if (!forceApply && clamped === this._browserZoomIndex) {
			return;
		}
		this._browserZoomIndex = clamped;
		await this.browserViewService.setBrowserZoomIndex(this.id, this._browserZoomIndex);
		this._onDidChangeZoom.fire();
	}

	async zoomIn(): Promise<void> {
		if (!this.canZoomIn) {
			return;
		}
		await this.setBrowserZoomIndex(this._browserZoomIndex + 1);
		if (this._zoomHost) {
			this.zoomService.setHostZoomIndex(this._zoomHost, this._browserZoomIndex, this._isEphemeral);
		}
	}

	async zoomOut(): Promise<void> {
		if (!this.canZoomOut) {
			return;
		}
		await this.setBrowserZoomIndex(this._browserZoomIndex - 1);
		if (this._zoomHost) {
			this.zoomService.setHostZoomIndex(this._zoomHost, this._browserZoomIndex, this._isEphemeral);
		}
	}

	async resetZoom(): Promise<void> {
		const defaultIndex = this.zoomService.getEffectiveZoomIndex(undefined, false);
		await this.setBrowserZoomIndex(defaultIndex);
		if (this._zoomHost) {
			this.zoomService.setHostZoomIndex(this._zoomHost, defaultIndex, this._isEphemeral);
		}
	}

	async getConsoleLogs(): Promise<string> {
		return this.browserViewService.getConsoleLogs(this.id);
	}

	get isElementSelectionActive(): boolean {
		return this._isElementSelectionActive;
	}

	async toggleElementSelection(enabled?: boolean): Promise<void> {
		return this.browserViewService.toggleElementSelection(this.id, enabled);
	}

	get onDidSelectElement(): Event<IElementData> {
		return this.browserViewService.onDynamicDidSelectElement(this.id);
	}

	get onDidChangeElementSelectionActive(): Event<boolean> {
		return this.browserViewService.onDynamicDidChangeElementSelectionActive(this.id);
	}

	async setSharedWithAgent(shared: boolean): Promise<boolean> {
		if (!shared) {
			this._setSharedWithAgent(false);
			return true;
		}
		return false;
	}

	private _setSharedWithAgent(isShared: boolean): void {
		if (isShared !== this._sharedWithAgent) {
			this._sharedWithAgent = isShared;
			this._onDidChangeSharingState.fire(this.sharingState);
		}
	}

	/**
	 * Log navigation telemetry event
	 */
	private logNavigationTelemetry(navigationType: IntegratedBrowserNavigationEvent['navigationType'], url: string): void {
		let localhost: boolean;
		try {
			localhost = isLocalhostAuthority(new URL(url).host);
		} catch {
			localhost = false;
		}

		this.telemetryService.publicLog2<IntegratedBrowserNavigationEvent, IntegratedBrowserNavigationClassification>(
			'integratedBrowser.navigation',
			{
				navigationType,
				isLocalhost: localhost
			}
		);
	}

	override dispose(): void {
		this._onWillDispose.fire();

		// Clean up the browser view when the model is disposed
		void this.browserViewService.destroyBrowserView(this.id);

		super.dispose();
	}
}
