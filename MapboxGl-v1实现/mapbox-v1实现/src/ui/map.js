// @flow

import {version} from '../../package.json';
import {extend, bindAll, warnOnce, uniqueId} from '../util/util';
import browser from '../util/browser';
import window from '../util/window';
const {HTMLImageElement, HTMLElement, ImageBitmap} = window;
import DOM from '../util/dom';
import {getImage, getJSON, ResourceType} from '../util/ajax';
import {RequestManager} from '../util/mapbox';
import Style from '../style/style';
import EvaluationParameters from '../style/evaluation_parameters';
import Painter from '../render/painter';
import Transform from '../geo/transform';
import HandlerManager from './handler_manager';
import Camera from './camera';
import LngLat from '../geo/lng_lat';
import LngLatBounds from '../geo/lng_lat_bounds';
import Point from '@mapbox/point-geometry';
import isSupported from '@mapbox/mapbox-gl-supported';
import {RGBAImage} from '../util/image';
import {Event, ErrorEvent} from '../util/evented';
import {MapMouseEvent} from './events';
import TaskQueue from '../util/task_queue';
import webpSupported from '../util/webp_supported';
import {PerformanceMarkers, PerformanceUtils} from '../util/performance';

import {setCacheLimits} from '../util/tile_request_cache';

import type {PointLike} from '@mapbox/point-geometry';
import type {RequestTransformFunction} from '../util/mapbox';
import type {LngLatLike} from '../geo/lng_lat';
import type {LngLatBoundsLike} from '../geo/lng_lat_bounds';
import type {StyleOptions, StyleSetterOptions} from '../style/style';
import type {MapEvent, MapDataEvent} from './events';
import type {CustomLayerInterface} from '../style/style_layer/custom_style_layer';
import type {StyleImageInterface, StyleImageMetadata} from '../style/style_image';

import type ScrollZoomHandler from './handler/scroll_zoom';
import type BoxZoomHandler from './handler/box_zoom';
import type {TouchPitchHandler} from './handler/touch_zoom_rotate';
import type DragRotateHandler from './handler/shim/drag_rotate';
import type DragPanHandler, {DragPanOptions} from './handler/shim/drag_pan';
import type KeyboardHandler from './handler/keyboard';
import type DoubleClickZoomHandler from './handler/shim/dblclick_zoom';
import type TouchZoomRotateHandler from './handler/shim/touch_zoom_rotate';
import defaultLocale from './default_locale';
import type {TaskID} from '../util/task_queue';
import type {Cancelable} from '../types/cancelable';
import type {
    LayerSpecification,
    FilterSpecification,
    StyleSpecification,
    LightSpecification,
    SourceSpecification
} from '../style-spec/types';

type ControlPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
/* eslint-disable no-use-before-define */
type IControl = {
    onAdd(map: Map): HTMLElement;
    onRemove(map: Map): void;

    +getDefaultPosition?: () => ControlPosition;
}
/* eslint-enable no-use-before-define */

type MapOptions = {
    hash?: boolean | string,
    interactive?: boolean,
    container: HTMLElement | string,
    bearingSnap?: number,
    customAttribution?: string | Array<string>,
    logoPosition?: ControlPosition,
    failIfMajorPerformanceCaveat?: boolean,
    preserveDrawingBuffer?: boolean,
    antialias?: boolean,
    refreshExpiredTiles?: boolean,
    maxBounds?: LngLatBoundsLike,
    scrollZoom?: boolean,
    minZoom?: ?number,
    maxZoom?: ?number,
    minPitch?: ?number,
    maxPitch?: ?number,
    boxZoom?: boolean,
    dragRotate?: boolean,
    dragPan?: DragPanOptions,
    keyboard?: boolean,
    doubleClickZoom?: boolean,
    touchZoomRotate?: boolean,
    touchPitch?: boolean,
    trackResize?: boolean,
    center?: LngLatLike,
    zoom?: number,
    bearing?: number,
    pitch?: number,
    renderWorldCopies?: boolean,
    maxTileCacheSize?: number,
    transformRequest?: RequestTransformFunction,
    accessToken: string,
    locale?: Object
};

const defaultMinZoom = -2;
const defaultMaxZoom = 22;

// the default values, but also the valid range
const defaultMinPitch = 0;
const defaultMaxPitch = 60;

const defaultOptions = {
    center: [0, 0],
    zoom: 0,
    bearing: 0,
    pitch: 0,

    minZoom: defaultMinZoom,
    maxZoom: defaultMaxZoom,

    minPitch: defaultMinPitch,
    maxPitch: defaultMaxPitch,

    interactive: true,
    scrollZoom: true,
    boxZoom: true,
    dragRotate: true,
    dragPan: true,
    keyboard: true,
    doubleClickZoom: true,
    touchZoomRotate: true,
    touchPitch: true,

    bearingSnap: 7,
    clickTolerance: 3,
    pitchWithRotate: true,

    hash: false,

    failIfMajorPerformanceCaveat: false,
    preserveDrawingBuffer: false,
    trackResize: true,
    renderWorldCopies: true,
    refreshExpiredTiles: true,
    maxTileCacheSize: null,
    localIdeographFontFamily: 'sans-serif',
    transformRequest: null,
    accessToken: null,
    fadeDuration: 300,
    crossSourceCollisions: true
};

/**
 * The `Map` object represents the map on your page. It exposes methods
 * and properties that enable you to programmatically change the map,
 * and fires events as users interact with it.
 *
 * You create a `Map` by specifying a `container` and other options.
 * Then Mapbox GL JS initializes the map on the page and returns your `Map`
 * object.
 *
 * @extends Evented
 * @param {Object} options
 * @param {HTMLElement|string} options.container The HTML element in which Mapbox GL JS will render the map, or the element's string `id`. The specified element must have no children.
 * @param {number} [options.minZoom=0] The minimum zoom level of the map (0-24).
 * @param {number} [options.maxZoom=22] The maximum zoom level of the map (0-24).
 * @param {number} [options.minPitch=0] The minimum pitch of the map (0-60).
 * @param {number} [options.maxPitch=60] The maximum pitch of the map (0-60).
 * @param {Object|string} [options.style] The map's Mapbox style. This must be an a JSON object conforming to
 * the schema described in the [Mapbox Style Specification](https://mapbox.com/mapbox-gl-style-spec/), or a URL to
 * such JSON.
 *
 * To load a style from the Mapbox API, you can use a URL of the form `mapbox://styles/:owner/:style`,
 * where `:owner` is your Mapbox account name and `:style` is the style ID. Or you can use one of the following
 * [the predefined Mapbox styles](https://www.mapbox.com/maps/):
 *
 *  * `mapbox://styles/mapbox/streets-v11`
 *  * `mapbox://styles/mapbox/outdoors-v11`
 *  * `mapbox://styles/mapbox/light-v10`
 *  * `mapbox://styles/mapbox/dark-v10`
 *  * `mapbox://styles/mapbox/satellite-v9`
 *  * `mapbox://styles/mapbox/satellite-streets-v11`
 *  * `mapbox://styles/mapbox/navigation-preview-day-v4`
 *  * `mapbox://styles/mapbox/navigation-preview-night-v4`
 *  * `mapbox://styles/mapbox/navigation-guidance-day-v4`
 *  * `mapbox://styles/mapbox/navigation-guidance-night-v4`
 *
 * Tilesets hosted with Mapbox can be style-optimized if you append `?optimize=true` to the end of your style URL, like `mapbox://styles/mapbox/streets-v11?optimize=true`.
 * Learn more about style-optimized vector tiles in our [API documentation](https://www.mapbox.com/api-documentation/maps/#retrieve-tiles).
 *
 * @param {(boolean|string)} [options.hash=false] If `true`, the map's position (zoom, center latitude, center longitude, bearing, and pitch) will be synced with the hash fragment of the page's URL.
 *   For example, `http://path/to/my/page.html#2.59/39.26/53.07/-24.1/60`.
 *   An additional string may optionally be provided to indicate a parameter-styled hash,
 *   e.g. http://path/to/my/page.html#map=2.59/39.26/53.07/-24.1/60&foo=bar, where foo
 *   is a custom parameter and bar is an arbitrary hash distinct from the map hash.
 * @param {boolean} [options.interactive=true] If `false`, no mouse, touch, or keyboard listeners will be attached to the map, so it will not respond to interaction.
 * @param {number} [options.bearingSnap=7] The threshold, measured in degrees, that determines when the map's
 *   bearing will snap to north. For example, with a `bearingSnap` of 7, if the user rotates
 *   the map within 7 degrees of north, the map will automatically snap to exact north.
 * @param {boolean} [options.pitchWithRotate=true] If `false`, the map's pitch (tilt) control with "drag to rotate" interaction will be disabled.
 * @param {number} [options.clickTolerance=3] The max number of pixels a user can shift the mouse pointer during a click for it to be considered a valid click (as opposed to a mouse drag).
 * @param {boolean} [options.attributionControl=true] If `true`, an {@link AttributionControl} will be added to the map.
 * @param {string | Array<string>} [options.customAttribution] String or strings to show in an {@link AttributionControl}. Only applicable if `options.attributionControl` is `true`.
 * @param {string} [options.logoPosition='bottom-left'] A string representing the position of the Mapbox wordmark on the map. Valid options are `top-left`,`top-right`, `bottom-left`, `bottom-right`.
 * @param {boolean} [options.failIfMajorPerformanceCaveat=false] If `true`, map creation will fail if the performance of Mapbox
 *   GL JS would be dramatically worse than expected (i.e. a software renderer would be used).
 * @param {boolean} [options.preserveDrawingBuffer=false] If `true`, the map's canvas can be exported to a PNG using `map.getCanvas().toDataURL()`. This is `false` by default as a performance optimization.
 * @param {boolean} [options.antialias] If `true`, the gl context will be created with MSAA antialiasing, which can be useful for antialiasing custom layers. this is `false` by default as a performance optimization.
 * @param {boolean} [options.refreshExpiredTiles=true] If `false`, the map won't attempt to re-request tiles once they expire per their HTTP `cacheControl`/`expires` headers.
 * @param {LngLatBoundsLike} [options.maxBounds] If set, the map will be constrained to the given bounds.
 * @param {boolean|Object} [options.scrollZoom=true] If `true`, the "scroll to zoom" interaction is enabled. An `Object` value is passed as options to {@link ScrollZoomHandler#enable}.
 * @param {boolean} [options.boxZoom=true] If `true`, the "box zoom" interaction is enabled (see {@link BoxZoomHandler}).
 * @param {boolean} [options.dragRotate=true] If `true`, the "drag to rotate" interaction is enabled (see {@link DragRotateHandler}).
 * @param {boolean|Object} [options.dragPan=true] If `true`, the "drag to pan" interaction is enabled. An `Object` value is passed as options to {@link DragPanHandler#enable}.
 * @param {boolean} [options.keyboard=true] If `true`, keyboard shortcuts are enabled (see {@link KeyboardHandler}).
 * @param {boolean} [options.doubleClickZoom=true] If `true`, the "double click to zoom" interaction is enabled (see {@link DoubleClickZoomHandler}).
 * @param {boolean|Object} [options.touchZoomRotate=true] If `true`, the "pinch to rotate and zoom" interaction is enabled. An `Object` value is passed as options to {@link TouchZoomRotateHandler#enable}.
 * @param {boolean|Object} [options.touchPitch=true] If `true`, the "drag to pitch" interaction is enabled. An `Object` value is passed as options to {@link TouchPitchHandler#enable}.
 * @param {boolean} [options.trackResize=true]  If `true`, the map will automatically resize when the browser window resizes.
 * @param {LngLatLike} [options.center=[0, 0]] The inital geographical centerpoint of the map. If `center` is not specified in the constructor options, Mapbox GL JS will look for it in the map's style object. If it is not specified in the style, either, it will default to `[0, 0]` Note: Mapbox GL uses longitude, latitude coordinate order (as opposed to latitude, longitude) to match GeoJSON.
 * @param {number} [options.zoom=0] The initial zoom level of the map. If `zoom` is not specified in the constructor options, Mapbox GL JS will look for it in the map's style object. If it is not specified in the style, either, it will default to `0`.
 * @param {number} [options.bearing=0] The initial bearing (rotation) of the map, measured in degrees counter-clockwise from north. If `bearing` is not specified in the constructor options, Mapbox GL JS will look for it in the map's style object. If it is not specified in the style, either, it will default to `0`.
 * @param {number} [options.pitch=0] The initial pitch (tilt) of the map, measured in degrees away from the plane of the screen (0-60). If `pitch` is not specified in the constructor options, Mapbox GL JS will look for it in the map's style object. If it is not specified in the style, either, it will default to `0`.
 * @param {LngLatBoundsLike} [options.bounds] The initial bounds of the map. If `bounds` is specified, it overrides `center` and `zoom` constructor options.
 * @param {Object} [options.fitBoundsOptions] A {@link Map#fitBounds} options object to use _only_ when fitting the initial `bounds` provided above.
 * @param {boolean} [options.renderWorldCopies=true]  If `true`, multiple copies of the world will be rendered side by side beyond -180 and 180 degrees longitude. If set to `false`:
 * - When the map is zoomed out far enough that a single representation of the world does not fill the map's entire
 * container, there will be blank space beyond 180 and -180 degrees longitude.
 * - Features that cross 180 and -180 degrees longitude will be cut in two (with one portion on the right edge of the
 * map and the other on the left edge of the map) at every zoom level.
 * @param {number} [options.maxTileCacheSize=null]  The maximum number of tiles stored in the tile cache for a given source. If omitted, the cache will be dynamically sized based on the current viewport.
 * @param {string} [options.localIdeographFontFamily='sans-serif'] Defines a CSS
 *   font-family for locally overriding generation of glyphs in the 'CJK Unified Ideographs', 'Hiragana', 'Katakana' and 'Hangul Syllables' ranges.
 *   In these ranges, font settings from the map's style will be ignored, except for font-weight keywords (light/regular/medium/bold).
 *   Set to `false`, to enable font settings from the map's style for these glyph ranges.  Note that [Mapbox Studio](https://studio.mapbox.com/) sets this value to `false` by default.
 *   The purpose of this option is to avoid bandwidth-intensive glyph server requests. (See [Use locally generated ideographs](https://www.mapbox.com/mapbox-gl-js/example/local-ideographs).)
 * @param {RequestTransformFunction} [options.transformRequest=null] A callback run before the Map makes a request for an external URL. The callback can be used to modify the url, set headers, or set the credentials property for cross-origin requests.
 *   Expected to return an object with a `url` property and optionally `headers` and `credentials` properties.
 * @param {boolean} [options.collectResourceTiming=false] If `true`, Resource Timing API information will be collected for requests made by GeoJSON and Vector Tile web workers (this information is normally inaccessible from the main Javascript thread). Information will be returned in a `resourceTiming` property of relevant `data` events.
 * @param {number} [options.fadeDuration=300] Controls the duration of the fade-in/fade-out animation for label collisions, in milliseconds. This setting affects all symbol layers. This setting does not affect the duration of runtime styling transitions or raster tile cross-fading.
 * @param {boolean} [options.crossSourceCollisions=true] If `true`, symbols from multiple sources can collide with each other during collision detection. If `false`, collision detection is run separately for the symbols in each source.
 * @param {string} [options.accessToken=null] If specified, map will use this token instead of the one defined in mapboxgl.accessToken.
 * @param {Object} [options.locale=null] A patch to apply to the default localization table for UI strings, e.g. control tooltips. The `locale` object maps namespaced UI string IDs to translated strings in the target language; see `src/ui/default_locale.js` for an example with all supported string IDs. The object may specify all UI strings (thereby adding support for a new translation) or only a subset of strings (thereby patching the default translation table).
 * @example
 * var map = new mapboxgl.Map({
 *   container: 'map',
 *   center: [-122.420679, 37.772537],
 *   zoom: 13,
 *   style: style_object,
 *   hash: true,
 *   transformRequest: (url, resourceType)=> {
 *     if(resourceType === 'Source' && url.startsWith('http://myHost')) {
 *       return {
 *        url: url.replace('http', 'https'),
 *        headers: { 'my-custom-header': true},
 *        credentials: 'include'  // Include cookies for cross-origin requests
 *      }
 *     }
 *   }
 * });
 * @see [Display a map](https://www.mapbox.com/mapbox-gl-js/examples/)
 */
class Map extends Camera {
    style: Style;
    painter: Painter;
    handlers: HandlerManager;

    _container: HTMLElement;
    _missingCSSCanary: HTMLElement;
    _canvasContainer: HTMLElement;
    _controlContainer: HTMLElement;
    _controlPositions: {[_: string]: HTMLElement};
    _interactive: ?boolean;
    _showTileBoundaries: ?boolean;
    _showCollisionBoxes: ?boolean;
    _showPadding: ?boolean;
    _showOverdrawInspector: boolean;
    _repaint: ?boolean;
    _vertices: ?boolean;
    _canvas: HTMLCanvasElement;
    _maxTileCacheSize: number;
    _frame: ?Cancelable;
    _styleDirty: ?boolean;
    _sourcesDirty: ?boolean;
    _placementDirty: ?boolean;
    _loaded: boolean;
    // accounts for placement finishing as well
    _fullyLoaded: boolean;
    _trackResize: boolean;
    _preserveDrawingBuffer: boolean;
    _failIfMajorPerformanceCaveat: boolean;
    _antialias: boolean;
    _refreshExpiredTiles: boolean;
    _delegatedListeners: any;
    _fadeDuration: number;
    _crossSourceCollisions: boolean;
    _crossFadingFactor: number;
    _collectResourceTiming: boolean;
    _renderTaskQueue: TaskQueue;
    _controls: Array<IControl>;
    _mapId: number;
    _localIdeographFontFamily: string;
    _requestManager: RequestManager;
    _locale: Object;
    _removed: boolean;

    /**
     * The map's {@link ScrollZoomHandler}, which implements zooming in and out with a scroll wheel or trackpad.
     * Find more details and examples using `scrollZoom` in the {@link ScrollZoomHandler} section.
     */
    scrollZoom: ScrollZoomHandler;

    /**
     * The map's {@link BoxZoomHandler}, which implements zooming using a drag gesture with the Shift key pressed.
     * Find more details and examples using `boxZoom` in the {@link BoxZoomHandler} section.
     */
    boxZoom: BoxZoomHandler;

    /**
     * The map's {@link DragRotateHandler}, which implements rotating the map while dragging with the right
     * mouse button or with the Control key pressed. Find more details and examples using `dragRotate`
     * in the {@link DragRotateHandler} section.
     */
    dragRotate: DragRotateHandler;

    /**
     * The map's {@link DragPanHandler}, which implements dragging the map with a mouse or touch gesture.
     * Find more details and examples using `dragPan` in the {@link DragPanHandler} section.
     */
    dragPan: DragPanHandler;

    /**
     * The map's {@link KeyboardHandler}, which allows the user to zoom, rotate, and pan the map using keyboard
     * shortcuts. Find more details and examples using `keyboard` in the {@link KeyboardHandler} section.
     */
    keyboard: KeyboardHandler;

    /**
     * The map's {@link DoubleClickZoomHandler}, which allows the user to zoom by double clicking.
     * Find more details and examples using `doubleClickZoom` in the {@link DoubleClickZoomHandler} section.
     */
    doubleClickZoom: DoubleClickZoomHandler;

    /**
     * The map's {@link TouchZoomRotateHandler}, which allows the user to zoom or rotate the map with touch gestures.
     * Find more details and examples using `touchZoomRotate` in the {@link TouchZoomRotateHandler} section.
     */
    touchZoomRotate: TouchZoomRotateHandler;

    /**
     * The map's {@link TouchPitchHandler}, which allows the user to pitch the map with touch gestures.
     * Find more details and examples using `touchPitch` in the {@link TouchPitchHandler} section.
     */
    touchPitch: TouchPitchHandler;

    constructor(options: MapOptions) {
        PerformanceUtils.mark(PerformanceMarkers.create);

        options = extend({}, defaultOptions, options);

        if (options.minZoom != null && options.maxZoom != null && options.minZoom > options.maxZoom) {
            throw new Error(`maxZoom must be greater than or equal to minZoom`);
        }

        if (options.minPitch != null && options.maxPitch != null && options.minPitch > options.maxPitch) {
            throw new Error(`maxPitch must be greater than or equal to minPitch`);
        }

        if (options.minPitch != null && options.minPitch < defaultMinPitch) {
            throw new Error(`minPitch must be greater than or equal to ${defaultMinPitch}`);
        }

        if (options.maxPitch != null && options.maxPitch > defaultMaxPitch) {
            throw new Error(`maxPitch must be less than or equal to ${defaultMaxPitch}`);
        }

        const transform = new Transform(options.minZoom, options.maxZoom, options.minPitch, options.maxPitch, options.renderWorldCopies);
        super(transform, options);

        this._interactive = options.interactive;
        this._maxTileCacheSize = options.maxTileCacheSize;
        this._failIfMajorPerformanceCaveat = options.failIfMajorPerformanceCaveat;
        this._preserveDrawingBuffer = options.preserveDrawingBuffer;
        this._antialias = options.antialias;
        this._trackResize = options.trackResize;
        this._bearingSnap = options.bearingSnap;
        this._refreshExpiredTiles = options.refreshExpiredTiles;
        this._fadeDuration = options.fadeDuration;
        this._crossSourceCollisions = options.crossSourceCollisions;
        this._crossFadingFactor = 1;
        this._collectResourceTiming = options.collectResourceTiming;
        this._renderTaskQueue = new TaskQueue();
        this._controls = [];
        this._mapId = uniqueId();
        this._locale = extend({}, defaultLocale, options.locale);

        this._requestManager = new RequestManager(options.transformRequest, options.accessToken);

        if (typeof options.container === 'string') {
            this._container = window.document.getElementById(options.container);
            if (!this._container) {
                throw new Error(`Container '${options.container}' not found.`);
            }
        } else if (options.container instanceof HTMLElement) {
            this._container = options.container;
        } else {
            throw new Error(`Invalid type: 'container' must be a String or HTMLElement.`);
        }

        if (options.maxBounds) {
            this.setMaxBounds(options.maxBounds);
        }

        bindAll([
            '_onWindowOnline',
            '_onWindowResize',
            '_contextLost',
            '_contextRestored'
        ], this);

        this._setupContainer();
        this._setupPainter();
        if (this.painter === undefined) {
            throw new Error(`Failed to initialize WebGL.`);
        }

        this.on('move', () => this._update(false));
        this.on('moveend', () => this._update(false));
        this.on('zoom', () => this._update(true));

        if (typeof window !== 'undefined') {
            window.addEventListener('online', this._onWindowOnline, false);
            window.addEventListener('resize', this._onWindowResize, false);
            window.addEventListener('orientationchange', this._onWindowResize, false);
        }

        this.handlers = new HandlerManager(this, options);
        // don't set position from options if set through hash
        if (!this._hash || !this._hash._onHashChange()) {
            this.jumpTo({
                center: options.center,
                zoom: options.zoom,
                bearing: options.bearing,
                pitch: options.pitch
            });

            if (options.bounds) {
                this.resize();
                this.fitBounds(options.bounds, extend({}, options.fitBoundsOptions, {duration: 0}));
            }
        }

        this.resize();

        this._localIdeographFontFamily = options.localIdeographFontFamily;
        if (options.style) this.setStyle(options.style, {localIdeographFontFamily: options.localIdeographFontFamily});

        this.on('style.load', () => {
            if (this.transform.unmodified) {
                this.jumpTo((this.style.stylesheet: any));
            }
        });
        this.on('data', (event: MapDataEvent) => {
            this._update(event.dataType === 'style');
            this.fire(new Event(`${event.dataType}data`, event));
        });
        this.on('dataloading', (event: MapDataEvent) => {
            this.fire(new Event(`${event.dataType}dataloading`, event));
        });
    }

    /*
    * Returns a unique number for this map instance which is used for the MapLoadEvent
    * to make sure we only fire one event per instantiated map object.
    * @private
    * @returns {number}
    */
    _getMapId() {
        return this._mapId;
    }

    /**
     * Resizes the map according to the dimensions of its
     * `container` element.
     *
     * Checks if the map container size changed and updates the map if it has changed.
     * This method must be called after the map's `container` is resized programmatically
     * or when the map is shown after being initially hidden with CSS.
     *
     * @param eventData Additional properties to be passed to `movestart`, `move`, `resize`, and `moveend`
     *   events that get triggered as a result of resize. This can be useful for differentiating the
     *   source of an event (for example, user-initiated or programmatically-triggered events).
     * @returns {Map} `this`
     * @example
     * // Resize the map when the map container is shown
     * // after being initially hidden with CSS.
     * var mapDiv = document.getElementById('map');
     * if (mapDiv.style.visibility === true) map.resize();
     */
    resize(eventData?: Object) {
        const dimensions = this._containerDimensions();
        const width = dimensions[0];
        const height = dimensions[1];

        this._resizeCanvas(width, height);
        this.transform.resize(width, height);
        this.painter.resize(width, height);

        const fireMoving = !this._moving;
        if (fireMoving) {
            this.stop();
            this.fire(new Event('movestart', eventData))
                .fire(new Event('move', eventData));
        }

        this.fire(new Event('resize', eventData));

        if (fireMoving) this.fire(new Event('moveend', eventData));

        return this;
    }

    /**
     * Returns a {@link LngLat} representing geographical coordinates that correspond
     * to the specified pixel coordinates.
     *
     * @param {PointLike} point The pixel coordinates to unproject.
     * @returns {LngLat} The {@link LngLat} corresponding to `point`.
     * @example
     * map.on('click', function(e) {
     *   // When the map is clicked, get the geographic coordinate.
     *   var coordinate = map.unproject(e.point);
     * });
     */
    // need
    unproject(point: PointLike) {
        return this.transform.pointLocation(Point.convert(point));
    }

    /**
     * Returns true if the map is panning, zooming, rotating, or pitching due to a camera animation or user gesture.
     * @returns {boolean} True if the map is moving.
     * @example
     * var isMoving = map.isMoving();
     */
    isMoving(): boolean {
        return this._moving || this.handlers.isMoving();
    }

    /**
     * Returns true if the map is zooming due to a camera animation or user gesture.
     * @returns {boolean} True if the map is zooming.
     * @example
     * var isZooming = map.isZooming();
     */
    isZooming(): boolean {
        return this._zooming || this.handlers.isZooming();
    }

    /**
     * Returns true if the map is rotating due to a camera animation or user gesture.
     * @returns {boolean} True if the map is rotating.
     * @example
     * map.isRotating();
     */
    isRotating(): boolean {
        return this._rotating || this.handlers.isRotating();
    }

    addLayer(layer: LayerSpecification | CustomLayerInterface, beforeId?: string) {
        this._lazyInitEmptyStyle();
        this.style.addLayer(layer, beforeId);
        return this._update(true);
    }

    _createDelegatedListener(type: MapEvent, layerId: any, listener: any) {
        if (type === 'mouseenter' || type === 'mouseover') {
            let mousein = false;
            const mousemove = (e) => {
                const features = this.getLayer(layerId) ? this.queryRenderedFeatures(e.point, {layers: [layerId]}) : [];
                if (!features.length) {
                    mousein = false;
                } else if (!mousein) {
                    mousein = true;
                    listener.call(this, new MapMouseEvent(type, this, e.originalEvent, {features}));
                }
            };
            const mouseout = () => {
                mousein = false;
            };
            return {layer: layerId, listener, delegates: {mousemove, mouseout}};
        } else if (type === 'mouseleave' || type === 'mouseout') {
            let mousein = false;
            const mousemove = (e) => {
                const features = this.getLayer(layerId) ? this.queryRenderedFeatures(e.point, {layers: [layerId]}) : [];
                if (features.length) {
                    mousein = true;
                } else if (mousein) {
                    mousein = false;
                    listener.call(this, new MapMouseEvent(type, this, e.originalEvent));
                }
            };
            const mouseout = (e) => {
                if (mousein) {
                    mousein = false;
                    listener.call(this, new MapMouseEvent(type, this, e.originalEvent));
                }
            };
            return {layer: layerId, listener, delegates: {mousemove, mouseout}};
        } else {
            const delegate = (e) => {
                const features = this.getLayer(layerId) ? this.queryRenderedFeatures(e.point, {layers: [layerId]}) : [];
                if (features.length) {
                    // Here we need to mutate the original event, so that preventDefault works as expected.
                    e.features = features;
                    listener.call(this, e);
                    delete e.features;
                }
            };
            return {layer: layerId, listener, delegates: {[type]: delegate}};
        }
    }

    /**
     * Adds a listener for events of a specified type, optionally limited to features in a specified style layer.
     *
     * @param {string} type The event type to listen for. Events compatible with the optional `layerId` parameter are triggered
     * when the cursor enters a visible portion of the specified layer from outside that layer or outside the map canvas.
     *
     * | Event                                                     | Compatible with `layerId` |
     * |-----------------------------------------------------------|---------------------------|
     * | [`mousedown`](#map.event:mousedown)                       | yes                       |
     * | [`mouseup`](#map.event:mouseup)                           | yes                       |
     * | [`mouseover`](#map.event:mouseover)                       | yes                       |
     * | [`mouseout`](#map.event:mouseout)                         | yes                       |
     * | [`mousemove`](#map.event:mousemove)                       | yes                       |
     * | [`mouseenter`](#map.event:mouseenter)                     | yes (required)            |
     * | [`mouseleave`](#map.event:mouseleave)                     | yes (required)            |
     * | [`click`](#map.event:click)                               | yes                       |
     * | [`dblclick`](#map.event:dblclick)                         | yes                       |
     * | [`contextmenu`](#map.event:contextmenu)                   | yes                       |
     * | [`touchstart`](#map.event:touchstart)                     | yes                       |
     * | [`touchend`](#map.event:touchend)                         | yes                       |
     * | [`touchcancel`](#map.event:touchcancel)                   | yes                       |
     * | [`wheel`](#map.event:wheel)                               |                           |
     * | [`resize`](#map.event:resize)                             |                           |
     * | [`remove`](#map.event:remove)                             |                           |
     * | [`touchmove`](#map.event:touchmove)                       |                           |
     * | [`movestart`](#map.event:movestart)                       |                           |
     * | [`move`](#map.event:move)                                 |                           |
     * | [`moveend`](#map.event:moveend)                           |                           |
     * | [`dragstart`](#map.event:dragstart)                       |                           |
     * | [`drag`](#map.event:drag)                                 |                           |
     * | [`dragend`](#map.event:dragend)                           |                           |
     * | [`zoomstart`](#map.event:zoomstart)                       |                           |
     * | [`zoom`](#map.event:zoom)                                 |                           |
     * | [`zoomend`](#map.event:zoomend)                           |                           |
     * | [`rotatestart`](#map.event:rotatestart)                   |                           |
     * | [`rotate`](#map.event:rotate)                             |                           |
     * | [`rotateend`](#map.event:rotateend)                       |                           |
     * | [`pitchstart`](#map.event:pitchstart)                     |                           |
     * | [`pitch`](#map.event:pitch)                               |                           |
     * | [`pitchend`](#map.event:pitchend)                         |                           |
     * | [`boxzoomstart`](#map.event:boxzoomstart)                 |                           |
     * | [`boxzoomend`](#map.event:boxzoomend)                     |                           |
     * | [`boxzoomcancel`](#map.event:boxzoomcancel)               |                           |
     * | [`webglcontextlost`](#map.event:webglcontextlost)         |                           |
     * | [`webglcontextrestored`](#map.event:webglcontextrestored) |                           |
     * | [`load`](#map.event:load)                                 |                           |
     * | [`render`](#map.event:render)                             |                           |
     * | [`idle`](#map.event:idle)                                 |                           |
     * | [`error`](#map.event:error)                               |                           |
     * | [`data`](#map.event:data)                                 |                           |
     * | [`styledata`](#map.event:styledata)                       |                           |
     * | [`sourcedata`](#map.event:sourcedata)                     |                           |
     * | [`dataloading`](#map.event:dataloading)                   |                           |
     * | [`styledataloading`](#map.event:styledataloading)         |                           |
     * | [`sourcedataloading`](#map.event:sourcedataloading)       |                           |
     * | [`styleimagemissing`](#map.event:styleimagemissing)       |                           |
     *
     * @param {string} layerId (optional) The ID of a style layer. Event will only be triggered if its location
     * is within a visible feature in this layer. The event will have a `features` property containing
     * an array of the matching features. If `layerId` is not supplied, the event will not have a `features` property.
     * Please note that many event types are not compatible with the optional `layerId` parameter.
     * @param {Function} listener The function to be called when the event is fired.
     * @returns {Map} `this`
     * @example
     * // Set an event listener that will fire
     * // when the map has finished loading
     * map.on('load', function() {
     *   // Once the map has finished loading,
     *   // add a new layer
     *   map.addLayer({
     *     id: 'points-of-interest',
     *     source: {
     *       type: 'vector',
     *       url: 'mapbox://mapbox.mapbox-streets-v8'
     *     },
     *     'source-layer': 'poi_label',
     *     type: 'circle',
     *     paint: {
     *       // Mapbox Style Specification paint properties
     *     },
     *     layout: {
     *       // Mapbox Style Specification layout properties
     *     }
     *   });
     * });
     * @example
     * // Set an event listener that will fire
     * // when a feature on the countries layer of the map is clicked
     * map.on('click', 'countries', function(e) {
     *   new mapboxgl.Popup()
     *     .setLngLat(e.lngLat)
     *     .setHTML(`Country name: ${e.features[0].properties.name}`)
     *     .addTo(map);
     * });
     * @see [Display popup on click](https://docs.mapbox.com/mapbox-gl-js/example/popup-on-click/)
     * @see [Center the map on a clicked symbol](https://docs.mapbox.com/mapbox-gl-js/example/center-on-symbol/)
     * @see [Create a hover effect](https://docs.mapbox.com/mapbox-gl-js/example/hover-styles/)
     * @see [Create a draggable marker](https://docs.mapbox.com/mapbox-gl-js/example/drag-a-point/)
     */
    on(type: MapEvent, layerId: any, listener: any) {
        if (listener === undefined) {
            return super.on(type, layerId);
        }

        const delegatedListener = this._createDelegatedListener(type, layerId, listener);

        this._delegatedListeners = this._delegatedListeners || {};
        this._delegatedListeners[type] = this._delegatedListeners[type] || [];
        this._delegatedListeners[type].push(delegatedListener);

        for (const event in delegatedListener.delegates) {
            this.on((event: any), delegatedListener.delegates[event]);
        }

        return this;
    }

    /**
     * Adds a listener that will be called only once to a specified event type.
     *
     * @method
     * @name once
     * @memberof Map
     * @instance
     * @param {string} type The event type to add a listener for.
     * @param {Function} listener The function to be called when the event is fired.
     *   The listener function is called with the data object passed to `fire`,
     *   extended with `target` and `type` properties.
     * @returns {Map} `this`
     */

    /**
     * Adds a listener that will be called only once to a specified event type occurring on features in a specified style layer.
     *
     * @param {string} type The event type to listen for; one of `'mousedown'`, `'mouseup'`, `'click'`, `'dblclick'`,
     * `'mousemove'`, `'mouseenter'`, `'mouseleave'`, `'mouseover'`, `'mouseout'`, `'contextmenu'`, `'touchstart'`,
     * `'touchend'`, or `'touchcancel'`. `mouseenter` and `mouseover` events are triggered when the cursor enters
     * a visible portion of the specified layer from outside that layer or outside the map canvas. `mouseleave`
     * and `mouseout` events are triggered when the cursor leaves a visible portion of the specified layer, or leaves
     * the map canvas.
     * @param {string} layerId The ID of a style layer. Only events whose location is within a visible
     * feature in this layer will trigger the listener. The event will have a `features` property containing
     * an array of the matching features.
     * @param {Function} listener The function to be called when the event is fired.
     * @returns {Map} `this`
     */

    once(type: MapEvent, layerId: any, listener: any) {

        if (listener === undefined) {
            return super.once(type, layerId);
        }

        const delegatedListener = this._createDelegatedListener(type, layerId, listener);

        for (const event in delegatedListener.delegates) {
            this.once((event: any), delegatedListener.delegates[event]);
        }

        return this;
    }

    /**
     * Removes an event listener previously added with `Map#on`.
     *
     * @method
     * @name off
     * @memberof Map
     * @instance
     * @param {string} type The event type previously used to install the listener.
     * @param {Function} listener The function previously installed as a listener.
     * @returns {Map} `this`
     */

    /**
     * Removes an event listener for layer-specific events previously added with `Map#on`.
     *
     * @param {string} type The event type previously used to install the listener.
     * @param {string} layerId The layer ID previously used to install the listener.
     * @param {Function} listener The function previously installed as a listener.
     * @returns {Map} `this`
     */
    off(type: MapEvent, layerId: any, listener: any) {
        if (listener === undefined) {
            return super.off(type, layerId);
        }

        const removeDelegatedListener = (delegatedListeners) => {
            const listeners = delegatedListeners[type];
            for (let i = 0; i < listeners.length; i++) {
                const delegatedListener = listeners[i];
                if (delegatedListener.layer === layerId && delegatedListener.listener === listener) {
                    for (const event in delegatedListener.delegates) {
                        this.off((event: any), delegatedListener.delegates[event]);
                    }
                    listeners.splice(i, 1);
                    return this;
                }
            }
        };

        if (this._delegatedListeners && this._delegatedListeners[type]) {
            removeDelegatedListener(this._delegatedListeners);
        }

        return this;
    }

    /**
     * Updates the map's Mapbox style object with a new value.
     *
     * If a style is already set when this is used and options.diff is set to true, the map renderer will attempt to compare the given style
     * against the map's current state and perform only the changes necessary to make the map style match the desired state. Changes in sprites
     * (images used for icons and patterns) and glyphs (fonts for label text) **cannot** be diffed. If the sprites or fonts used in the current
     * style and the given style are different in any way, the map renderer will force a full update, removing the current style and building
     * the given one from scratch.
     *
     *
     * @param style A JSON object conforming to the schema described in the
     *   [Mapbox Style Specification](https://mapbox.com/mapbox-gl-style-spec/), or a URL to such JSON.
     * @param {Object} [options] Options object.
     * @param {boolean} [options.diff=true] If false, force a 'full' update, removing the current style
     *   and building the given one instead of attempting a diff-based update.
     * @param {string} [options.localIdeographFontFamily='sans-serif'] Defines a CSS
     *   font-family for locally overriding generation of glyphs in the 'CJK Unified Ideographs', 'Hiragana', 'Katakana' and 'Hangul Syllables' ranges.
     *   In these ranges, font settings from the map's style will be ignored, except for font-weight keywords (light/regular/medium/bold).
     *   Set to `false`, to enable font settings from the map's style for these glyph ranges.
     *   Forces a full update.
     * @returns {Map} `this`
     *
     * @example
     * map.setStyle("mapbox://styles/mapbox/streets-v11");
     *
     * @see [Change a map's style](https://www.mapbox.com/mapbox-gl-js/example/setstyle/)
     */
    setStyle(style: StyleSpecification | string | null, options?: {diff?: boolean} & StyleOptions) {
        options = extend({}, {localIdeographFontFamily: this._localIdeographFontFamily}, options);

        if ((options.diff !== false && options.localIdeographFontFamily === this._localIdeographFontFamily) && this.style && style) {
            this._diffStyle(style, options);
            return this;
        } else {
            this._localIdeographFontFamily = options.localIdeographFontFamily;
            return this._updateStyle(style, options);
        }
    }

    _getUIString(key: string) {
        const str = this._locale[key];
        if (str == null) {
            throw new Error(`Missing UI string '${key}'`);
        }

        return str;
    }

    _updateStyle(style: StyleSpecification | string | null,  options?: {diff?: boolean} & StyleOptions) {
        if (this.style) {
            this.style.setEventedParent(null);
            this.style._remove();
        }

        if (!style) {
            delete this.style;
            return this;
        } else {
            this.style = new Style(this, options || {});
        }

        this.style.setEventedParent(this, {style: this.style});

        if (typeof style === 'string') {
            this.style.loadURL(style);
        } else {
            this.style.loadJSON(style);
        }

        return this;
    }

    _lazyInitEmptyStyle() {
        if (!this.style) {
            this.style = new Style(this, {});
            this.style.setEventedParent(this, {style: this.style});
            this.style.loadEmpty();
        }
    }

    _diffStyle(style: StyleSpecification | string,  options?: {diff?: boolean} & StyleOptions) {
        if (typeof style === 'string') {
            const url = this._requestManager.normalizeStyleURL(style);
            const request = this._requestManager.transformRequest(url, ResourceType.Style);
            getJSON(request, (error: ?Error, json: ?Object) => {
                if (error) {
                    this.fire(new ErrorEvent(error));
                } else if (json) {
                    this._updateDiff(json, options);
                }
            });
        } else if (typeof style === 'object') {
            this._updateDiff(style, options);
        }
    }

    _updateDiff(style: StyleSpecification,  options?: {diff?: boolean} & StyleOptions) {
        try {
            if (this.style.setState(style)) {
                this._update(true);
            }
        } catch (e) {
            warnOnce(
                `Unable to perform style diff: ${e.message || e.error || e}.  Rebuilding the style from scratch.`
            );
            this._updateStyle(style, options);
        }
    }

    /**
     * Adds a source to the map's style.
     *
     * @param {string} id The ID of the source to add. Must not conflict with existing sources.
     * @param {Object} source The source object, conforming to the
     * Mapbox Style Specification's [source definition](https://www.mapbox.com/mapbox-gl-style-spec/#sources) or
     * {@link CanvasSourceOptions}.
     * @fires source.add
     * @returns {Map} `this`
     * @example
     * map.addSource('my-data', {
     *   type: 'vector',
     *   url: 'mapbox://myusername.tilesetid'
     * });
     * @example
     * map.addSource('my-data', {
     *   "type": "geojson",
     *   "data": {
     *     "type": "Feature",
     *     "geometry": {
     *       "type": "Point",
     *       "coordinates": [-77.0323, 38.9131]
     *     },
     *     "properties": {
     *       "title": "Mapbox DC",
     *       "marker-symbol": "monument"
     *     }
     *   }
     * });
     * @see Vector source: [Show and hide layers](https://docs.mapbox.com/mapbox-gl-js/example/toggle-layers/)
     * @see GeoJSON source: [Add live realtime data](https://docs.mapbox.com/mapbox-gl-js/example/live-geojson/)
     * @see Raster DEM source: [Add hillshading](https://docs.mapbox.com/mapbox-gl-js/example/hillshade/)
     */
    addSource(id: string, source: SourceSpecification) {
        this._lazyInitEmptyStyle();
        this.style.addSource(id, source);
        return this._update(true);
    }

    /**
     * Returns the map's containing HTML element.
     *
     * @returns {HTMLElement} The map's container.
     */
    getContainer() {
        return this._container;
    }

    /**
     * Returns the HTML element containing the map's `<canvas>` element.
     *
     * If you want to add non-GL overlays to the map, you should append them to this element.
     *
     * This is the element to which event bindings for map interactivity (such as panning and zooming) are
     * attached. It will receive bubbled events from child elements such as the `<canvas>`, but not from
     * map controls.
     *
     * @returns {HTMLElement} The container of the map's `<canvas>`.
     * @see [Create a draggable point](https://www.mapbox.com/mapbox-gl-js/example/drag-a-point/)
     * @see [Highlight features within a bounding box](https://www.mapbox.com/mapbox-gl-js/example/using-box-queryrenderedfeatures/)
     */
    getCanvasContainer() {
        return this._canvasContainer;
    }

    /**
     * Returns the map's `<canvas>` element.
     *
     * @returns {HTMLCanvasElement} The map's `<canvas>` element.
     * @see [Measure distances](https://www.mapbox.com/mapbox-gl-js/example/measure/)
     * @see [Display a popup on hover](https://www.mapbox.com/mapbox-gl-js/example/popup-on-hover/)
     * @see [Center the map on a clicked symbol](https://www.mapbox.com/mapbox-gl-js/example/center-on-symbol/)
     */
    getCanvas() {
        return this._canvas;
    }

    _containerDimensions() {
        let width = 0;
        let height = 0;

        if (this._container) {
            width = this._container.clientWidth || 400;
            height = this._container.clientHeight || 300;
        }

        return [width, height];
    }

    _detectMissingCSS(): void {
        const computedColor = window.getComputedStyle(this._missingCSSCanary).getPropertyValue('background-color');
        if (computedColor !== 'rgb(250, 128, 114)') {
            warnOnce('This page appears to be missing CSS declarations for ' +
                'Mapbox GL JS, which may cause the map to display incorrectly. ' +
                'Please ensure your page includes mapbox-gl.css, as described ' +
                'in https://www.mapbox.com/mapbox-gl-js/api/.');
        }
    }

    _setupContainer() {
        const container = this._container;
        container.classList.add('mapboxgl-map');

        const missingCSSCanary = this._missingCSSCanary = DOM.create('div', 'mapboxgl-canary', container);
        missingCSSCanary.style.visibility = 'hidden';
        this._detectMissingCSS();

        const canvasContainer = this._canvasContainer = DOM.create('div', 'mapboxgl-canvas-container', container);
        if (this._interactive) {
            canvasContainer.classList.add('mapboxgl-interactive');
        }

        this._canvas = DOM.create('canvas', 'mapboxgl-canvas', canvasContainer);
        this._canvas.addEventListener('webglcontextlost', this._contextLost, false);
        this._canvas.addEventListener('webglcontextrestored', this._contextRestored, false);
        this._canvas.setAttribute('tabindex', '0');
        this._canvas.setAttribute('aria-label', 'Map');

        const dimensions = this._containerDimensions();
        this._resizeCanvas(dimensions[0], dimensions[1]);
    }

    _resizeCanvas(width: number, height: number) {
        const pixelRatio = browser.devicePixelRatio || 1;

        // Request the required canvas size taking the pixelratio into account.
        this._canvas.width = pixelRatio * width;
        this._canvas.height = pixelRatio * height;

        // Maintain the same canvas size, potentially downscaling it for HiDPI displays
        this._canvas.style.width = `${width}px`;
        this._canvas.style.height = `${height}px`;
    }

    _setupPainter() {
        const attributes = extend({}, isSupported.webGLContextAttributes, {
            failIfMajorPerformanceCaveat: this._failIfMajorPerformanceCaveat,
            preserveDrawingBuffer: this._preserveDrawingBuffer,
            antialias: this._antialias || false
        });

        const gl = this._canvas.getContext('webgl', attributes) ||
            this._canvas.getContext('experimental-webgl', attributes);

        if (!gl) {
            this.fire(new ErrorEvent(new Error('Failed to initialize WebGL')));
            return;
        }

        this.painter = new Painter(gl, this.transform);

        webpSupported.testSupport(gl);
    }

    _contextLost(event: *) {
        event.preventDefault();
        if (this._frame) {
            this._frame.cancel();
            this._frame = null;
        }
        this.fire(new Event('webglcontextlost', {originalEvent: event}));
    }

    _contextRestored(event: *) {
        this._setupPainter();
        this.resize();
        this._update();
        this.fire(new Event('webglcontextrestored', {originalEvent: event}));
    }

    /**
     * Returns a Boolean indicating whether the map is fully loaded.
     *
     * Returns `false` if the style is not yet fully loaded,
     * or if there has been a change to the sources or style that
     * has not yet fully loaded.
     *
     * @returns {boolean} A Boolean indicating whether the map is fully loaded.
     */
    loaded() {
        return !this._styleDirty && !this._sourcesDirty && !!this.style && this.style.loaded();
    }

    /**
     * Update this map's style and sources, and re-render the map.
     *
     * @param {boolean} updateStyle mark the map's style for reprocessing as
     * well as its sources
     * @returns {Map} this
     * @private
     */
    _update(updateStyle?: boolean) {
        if (!this.style) return this;

        this._styleDirty = this._styleDirty || updateStyle;
        this._sourcesDirty = true;
        this.triggerRepaint();

        return this;
    }

    /**
     * Request that the given callback be executed during the next render
     * frame.  Schedule a render frame if one is not already scheduled.
     * @returns An id that can be used to cancel the callback
     * @private
     */
    _requestRenderFrame(callback: () => void): TaskID {
        this._update();
        return this._renderTaskQueue.add(callback);
    }

    _cancelRenderFrame(id: TaskID) {
        this._renderTaskQueue.remove(id);
    }

    /**
     * Call when a (re-)render of the map is required:
     * - The style has changed (`setPaintProperty()`, etc.)
     * - Source data has changed (e.g. tiles have finished loading)
     * - The map has is moving (or just finished moving)
     * - A transition is in progress
     *
     * @param {number} paintStartTimeStamp  The time when the animation frame began executing.
     *
     * @returns {Map} this
     * @private
     */
    _render(paintStartTimeStamp: number) {
        let gpuTimer, frameStartTime = 0;
        const extTimerQuery = this.painter.context.extTimerQuery;
        if (this.listens('gpu-timing-frame')) {
            gpuTimer = extTimerQuery.createQueryEXT();
            extTimerQuery.beginQueryEXT(extTimerQuery.TIME_ELAPSED_EXT, gpuTimer);
            frameStartTime = browser.now();
        }

        // A custom layer may have used the context asynchronously. Mark the state as dirty.
        this.painter.context.setDirty();
        this.painter.setBaseState();

        this._renderTaskQueue.run(paintStartTimeStamp);
        // A task queue callback may have fired a user event which may have removed the map
        if (this._removed) return;

        let crossFading = false;

        // If the style has changed, the map is being zoomed, or a transition or fade is in progress:
        //  - Apply style changes (in a batch)
        //  - Recalculate paint properties.
        if (this.style && this._styleDirty) {
            this._styleDirty = false;

            const zoom = this.transform.zoom;
            const now = browser.now();
            this.style.zoomHistory.update(zoom, now);

            const parameters = new EvaluationParameters(zoom, {
                now,
                fadeDuration: this._fadeDuration,
                zoomHistory: this.style.zoomHistory,
                transition: this.style.getTransition()
            });

            const factor = parameters.crossFadingFactor();
            if (factor !== 1 || factor !== this._crossFadingFactor) {
                crossFading = true;
                this._crossFadingFactor = factor;
            }

            this.style.update(parameters);
        }

        // If we are in _render for any reason other than an in-progress paint
        // transition, update source caches to check for and load any tiles we
        // need for the current transform
        if (this.style && this._sourcesDirty) {
            this._sourcesDirty = false;
            this.style._updateSources(this.transform);
        }

        this._placementDirty = this.style && this.style._updatePlacement(this.painter.transform, this.showCollisionBoxes, this._fadeDuration, this._crossSourceCollisions);

        // Actually draw
        this.painter.render(this.style, {
            showTileBoundaries: this.showTileBoundaries,
            showOverdrawInspector: this._showOverdrawInspector,
            rotating: this.isRotating(),
            zooming: this.isZooming(),
            moving: this.isMoving(),
            fadeDuration: this._fadeDuration,
            showPadding: this.showPadding,
            gpuTiming: !!this.listens('gpu-timing-layer'),
        });

        this.fire(new Event('render'));

        if (this.loaded() && !this._loaded) {
            this._loaded = true;
            PerformanceUtils.mark(PerformanceMarkers.load);
            this.fire(new Event('load'));
        }

        if (this.style && (this.style.hasTransitions() || crossFading)) {
            this._styleDirty = true;
        }

        if (this.style && !this._placementDirty) {
            // Since no fade operations are in progress, we can release
            // all tiles held for fading. If we didn't do this, the tiles
            // would just sit in the SourceCaches until the next render
            this.style._releaseSymbolFadeTiles();
        }

        if (this.listens('gpu-timing-frame')) {
            const renderCPUTime = browser.now() - frameStartTime;
            extTimerQuery.endQueryEXT(extTimerQuery.TIME_ELAPSED_EXT, gpuTimer);
            setTimeout(() => {
                const renderGPUTime = extTimerQuery.getQueryObjectEXT(gpuTimer, extTimerQuery.QUERY_RESULT_EXT) / (1000 * 1000);
                extTimerQuery.deleteQueryEXT(gpuTimer);
                this.fire(new Event('gpu-timing-frame', {
                    cpuTime: renderCPUTime,
                    gpuTime: renderGPUTime
                }));
            }, 50); // Wait 50ms to give time for all GPU calls to finish before querying
        }

        if (this.listens('gpu-timing-layer')) {
            // Resetting the Painter's per-layer timing queries here allows us to isolate
            // the queries to individual frames.
            const frameLayerQueries = this.painter.collectGpuTimers();

            setTimeout(() => {
                const renderedLayerTimes = this.painter.queryGpuTimers(frameLayerQueries);

                this.fire(new Event('gpu-timing-layer', {
                    layerTimes: renderedLayerTimes
                }));
            }, 50); // Wait 50ms to give time for all GPU calls to finish before querying
        }

        // Schedule another render frame if it's needed.
        //
        // Even though `_styleDirty` and `_sourcesDirty` are reset in this
        // method, synchronous events fired during Style#update or
        // Style#_updateSources could have caused them to be set again.
        const somethingDirty = this._sourcesDirty || this._styleDirty || this._placementDirty;
        if (somethingDirty || this._repaint) {
            this.triggerRepaint();
        } else if (!this.isMoving() && this.loaded()) {
            this.fire(new Event('idle'));
        }

        if (this._loaded && !this._fullyLoaded && !somethingDirty) {
            this._fullyLoaded = true;
            PerformanceUtils.mark(PerformanceMarkers.fullLoad);
        }

        return this;
    }

    /**
     * Clean up and release all internal resources associated with this map.
     *
     * This includes DOM elements, event bindings, web workers, and WebGL resources.
     *
     * Use this method when you are done using the map and wish to ensure that it no
     * longer consumes browser resources. Afterwards, you must not call any other
     * methods on the map.
     */
    remove() {
        if (this._hash) this._hash.remove();

        if (this._frame) {
            this._frame.cancel();
            this._frame = null;
        }
        this._renderTaskQueue.clear();
        this.painter.destroy();
        this.handlers.destroy();
        delete this.handlers;
        this.setStyle(null);
        if (typeof window !== 'undefined') {
            window.removeEventListener('resize', this._onWindowResize, false);
            window.removeEventListener('orientationchange', this._onWindowResize, false);
            window.removeEventListener('online', this._onWindowOnline, false);
        }

        const extension = this.painter.context.gl.getExtension('WEBGL_lose_context');
        if (extension) extension.loseContext();
        removeNode(this._canvasContainer);
        removeNode(this._missingCSSCanary);
        this._container.classList.remove('mapboxgl-map');

        PerformanceUtils.clearMetrics();

        this._removed = true;
        this.fire(new Event('remove'));
    }

    /**
     * Trigger the rendering of a single frame. Use this method with custom layers to
     * repaint the map when the layer changes. Calling this multiple times before the
     * next frame is rendered will still result in only a single frame being rendered.
     * @example
     * map.triggerRepaint();
     * @see [Add a 3D model](https://docs.mapbox.com/mapbox-gl-js/example/add-3d-model/)
     * @see [Add an animated icon to the map](https://docs.mapbox.com/mapbox-gl-js/example/add-image-animated/)
     */
    triggerRepaint() {
        if (this.style && !this._frame) {
            this._frame = browser.frame((paintStartTimeStamp: number) => {
                PerformanceUtils.frame(paintStartTimeStamp);
                this._frame = null;
                this._render(paintStartTimeStamp);
            });
        }
    }

    _onWindowOnline() {
        this._update();
    }

    _onWindowResize(event: Event) {
        if (this._trackResize) {
            this.resize({originalEvent: event})._update();
        }
    }

    /**
     * Gets and sets a Boolean indicating whether the map will render an outline
     * around each tile and the tile ID. These tile boundaries are useful for
     * debugging.
     *
     * The uncompressed file size of the first vector source is drawn in the top left
     * corner of each tile, next to the tile ID.
     *
     * @name showTileBoundaries
     * @type {boolean}
     * @instance
     * @memberof Map
     * @example
     * map.showTileBoundaries = true;
     */
    get showTileBoundaries(): boolean { return !!this._showTileBoundaries; }
    set showTileBoundaries(value: boolean) {
        if (this._showTileBoundaries === value) return;
        this._showTileBoundaries = value;
        this._update();
    }

    /**
     * Gets and sets a Boolean indicating whether the map will visualize
     * the padding offsets.
     *
     * @name showPadding
     * @type {boolean}
     * @instance
     * @memberof Map
     */
    get showPadding(): boolean { return !!this._showPadding; }
    set showPadding(value: boolean) {
        if (this._showPadding === value) return;
        this._showPadding = value;
        this._update();
    }

    /**
     * Gets and sets a Boolean indicating whether the map will render boxes
     * around all symbols in the data source, revealing which symbols
     * were rendered or which were hidden due to collisions.
     * This information is useful for debugging.
     *
     * @name showCollisionBoxes
     * @type {boolean}
     * @instance
     * @memberof Map
     */
    get showCollisionBoxes(): boolean { return !!this._showCollisionBoxes; }
    set showCollisionBoxes(value: boolean) {
        if (this._showCollisionBoxes === value) return;
        this._showCollisionBoxes = value;
        if (value) {
            // When we turn collision boxes on we have to generate them for existing tiles
            // When we turn them off, there's no cost to leaving existing boxes in place
            this.style._generateCollisionBoxes();
        } else {
            // Otherwise, call an update to remove collision boxes
            this._update();
        }
    }

    /*
     * Gets and sets a Boolean indicating whether the map should color-code
     * each fragment to show how many times it has been shaded.
     * White fragments have been shaded 8 or more times.
     * Black fragments have been shaded 0 times.
     * This information is useful for debugging.
     *
     * @name showOverdraw
     * @type {boolean}
     * @instance
     * @memberof Map
     */
    get showOverdrawInspector(): boolean { return !!this._showOverdrawInspector; }
    set showOverdrawInspector(value: boolean) {
        if (this._showOverdrawInspector === value) return;
        this._showOverdrawInspector = value;
        this._update();
    }

    /**
     * Gets and sets a Boolean indicating whether the map will
     * continuously repaint. This information is useful for analyzing performance.
     *
     * @name repaint
     * @type {boolean}
     * @instance
     * @memberof Map
     */
    get repaint(): boolean { return !!this._repaint; }
    set repaint(value: boolean) {
        if (this._repaint !== value) {
            this._repaint = value;
            this.triggerRepaint();
        }
    }
    // show vertices
    get vertices(): boolean { return !!this._vertices; }
    set vertices(value: boolean) { this._vertices = value; this._update(); }

    // for cache browser tests
    _setCacheLimits(limit: number, checkThreshold: number) {
        setCacheLimits(limit, checkThreshold);
    }

    /**
     * The version of Mapbox GL JS in use as specified in package.json, CHANGELOG.md, and the GitHub release.
     *
     * @name version
     * @instance
     * @memberof Map
     * @var {string} version
     */

    get version(): string { return version; }
}

export default Map;

function removeNode(node) {
    if (node.parentNode) {
        node.parentNode.removeChild(node);
    }
}

/**
 * A [`Point` geometry](https://github.com/mapbox/point-geometry) object, which has
 * `x` and `y` properties representing screen coordinates in pixels.
 *
 * @typedef {Object} Point
 * @example
 * var point = new mapboxgl.Point(-77, 38);
 */

/**
 * A {@link Point} or an array of two numbers representing `x` and `y` screen coordinates in pixels.
 *
 * @typedef {(Point | Array<number>)} PointLike
 * @example
 * var p1 = new mapboxgl.Point(-77, 38); // a PointLike which is a Point
 * var p2 = [-77, 38]; // a PointLike which is an array of two numbers
 */
