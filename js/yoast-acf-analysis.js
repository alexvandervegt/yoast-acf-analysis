(function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
/* global YoastSEO, acf, _, jQuery, wp */
var config = require( "./config/config.js" );
var helper = require( "./helper.js" );
var collect = require( "./collect/collect.js" );
var replaceVars = require( "./replacevars.js" );

var analysisTimeout = 0;

var App = function() {
	YoastSEO.app.registerPlugin( config.pluginName, { status: "ready" } );

	YoastSEO.app.registerModification( "content", collect.append.bind( collect ), config.pluginName );

	this.bindListeners();
};

/**
 * ACF 4 Listener.
 *
 * @param {Array} fieldSelectors List of field selectors.
 * @param {string} wysiwygSelector Element selector for WYSIWYG fields.
 * @param {Array} fieldSelectorsWithoutWysiwyg List of fields.
 *
 * @returns {void}
 */
App.prototype.acf4Listener = function( fieldSelectors, wysiwygSelector, fieldSelectorsWithoutWysiwyg ) {
	replaceVars.updateReplaceVars( collect );

	var fieldsWithoutWysiwyg = jQuery( "#post-body, #edittag" ).find( fieldSelectorsWithoutWysiwyg.join( "," ) );
	var fields = jQuery( "#post-body, #edittag" ).find( fieldSelectors.join( "," ) );

	fieldsWithoutWysiwyg.on( "change", this.maybeRefresh.bind( this ) );
	// Do not ignore Wysiwyg fields for the purpose of Replace Vars.
	fields.on( "change", replaceVars.updateReplaceVars.bind( this, collect ) );

	if ( YoastSEO.wp._tinyMCEHelper ) {
		jQuery( wysiwygSelector ).each( function() {
			YoastSEO.wp._tinyMCEHelper.addEventHandler( this.id, [ "input", "change", "cut", "paste" ],
				replaceVars.updateReplaceVars.bind( this, collect ) );
		} );
	}

	// Also refresh on media close as attachment data might have changed
	wp.media.frame.on( "close", this.maybeRefresh );
};

/**
 * ACF 5 Listener.
 *
 * @returns {void}
 */
App.prototype.acf5Listener = function() {
	replaceVars.updateReplaceVars( collect );

	acf.add_action( "change remove append sortstop", this.maybeRefresh );
	acf.add_action( "change remove append sortstop", replaceVars.updateReplaceVars.bind( this, collect ) );
};

App.prototype.bindListeners = function() {
	if ( helper.acf_version >= 5 ) {
		jQuery( this.acf5Listener.bind( this ) );
	} else {
		var fieldSelectors = config.fieldSelectors.slice( 0 );
		var wysiwygSelector = "textarea[id^=wysiwyg-acf]";

		// Ignore Wysiwyg fields because they trigger a refresh in Yoast SEO itself
		var fieldSelectorsWithoutWysiwyg = _.without( fieldSelectors, wysiwygSelector );

		jQuery( document ).on( "acf/setup_fields", this.acf4Listener.bind( this, fieldSelectors, wysiwygSelector, fieldSelectorsWithoutWysiwyg ) );
	}
};

App.prototype.maybeRefresh = function() {
	if ( analysisTimeout ) {
		window.clearTimeout( analysisTimeout );
	}

	analysisTimeout = window.setTimeout( function() {
		if ( config.debug ) {
			console.log( "Recalculate..." + new Date() + "(Internal)" );
		}

		YoastSEO.app.pluginReloaded( config.pluginName );
	}, config.refreshRate );
};

module.exports = App;

},{"./collect/collect.js":6,"./config/config.js":7,"./helper.js":8,"./replacevars.js":10}],2:[function(require,module,exports){
/* global _ */
var cache = require( "./cache.js" );

var refresh = function( attachment_ids ) {
	var uncached = cache.getUncached( attachment_ids, "attachment" );

	if ( uncached.length === 0 ) {
		return;
	}

	window.wp.ajax.post( "query-attachments", {
		query: {
			post__in: uncached,
		},
	} ).done( function( attachments ) {
		_.each( attachments, function( attachment ) {
			cache.set( attachment.id, attachment, "attachment" );
			window.YoastACFAnalysis.maybeRefresh();
		} );
	} );
};

var get = function( id ) {
	var attachment = cache.get( id, "attachment" );

	if ( ! attachment ) {
		return false;
	}

	var changedAttachment = window.wp.media.attachment( id );

	if ( changedAttachment.has( "alt" ) ) {
		attachment.alt = changedAttachment.get( "alt" );
	}

	if ( changedAttachment.has( "title" ) ) {
		attachment.title = changedAttachment.get( "title" );
	}

	return attachment;
};

module.exports = {
	refresh: refresh,
	get: get,
};

},{"./cache.js":3}],3:[function(require,module,exports){
/* global _ */
var Cache = function() {
	this.clear( "all" );
};

var _cache;

Cache.prototype.set = function( id, value, store ) {
	store = typeof store === "undefined" ? "default" : store;

	if ( ! ( store in _cache ) ) {
		_cache[ store ] = {};
	}

	_cache[ store ][ id ] = value;
};

Cache.prototype.get =  function( id, store ) {
	store = typeof store === "undefined" ? "default" : store;

	if ( store in _cache && id in _cache[ store ] ) {
		return _cache[ store ][ id ];
	}

	return false;
};

Cache.prototype.getUncached =  function( ids, store ) {
	store = typeof store === "undefined" ? "default" : store;

	var that = this;

	ids = _.uniq( ids );

	return ids.filter( function( id ) {
		var value = that.get( id, store );

		return value === false;
	} );
};

Cache.prototype.clear =  function( store ) {
	store = typeof store === "undefined" ? "default" : store;

	if ( store === "all" ) {
		_cache = {};
	} else {
		_cache[ store ] = {};
	}
};

module.exports = new Cache();

},{}],4:[function(require,module,exports){
/* global jQuery */

var config = require( "./../config/config.js" );
var fieldSelectors = config.fieldSelectors;

var field_data = [];

var fields = jQuery( "#post-body, #edittag" ).find( fieldSelectors.join( "," ) );

fields.each( function() {
	var $el = jQuery( this ).parents( ".field" ).last();

	field_data.push( {
		$el: $el,
		key: $el.data( "field_key" ),
		name: $el.data( "field_name" ),
		type: $el.data( "field_type" ),
		post_meta_key: $el.data( "field_name" ),
	} );
} );

module.exports = field_data;

},{"./../config/config.js":7}],5:[function(require,module,exports){
/* global _, acf, jQuery, wp */
module.exports = function() {
	var outerFieldsName = [
		"flexible_content",
		"repeater",
		"group",
	];

	var innerFields = [];
	var outerFields = [];
	var acfFields = [];

	if ( wp.data.select( "core/block-editor" ) ) {
		// Return only fields in metabox areas (either below or side) or
		// ACF block fields in the content (not in the sidebar, to prevent duplicates)
		var parentContainer = jQuery( ".metabox-location-normal, .metabox-location-side, .acf-block-component.acf-block-body" );
		acfFields = acf.get_fields( false, parentContainer );
	} else {
		acfFields = acf.get_fields();
	}

	var fields = _.map( acfFields, function( field ) {
		var fieldData = jQuery.extend( true, {}, acf.get_data( jQuery( field ) ) );
		fieldData.$el = jQuery( field );
		fieldData.post_meta_key = fieldData.name;

		// Collect nested and parent
		if ( outerFieldsName.indexOf( fieldData.type ) === -1 ) {
			innerFields.push( fieldData );
		} else {
			outerFields.push( fieldData );
		}

		return fieldData;
	} );

	// Add ACF block previews, they are not returned by acf.get_fields()
	// First check if we can use Gutenberg.
	if ( wp.data.select( "core/block-editor" ) ) {
		// Gutenberg is available.
		var blocks = wp.data.select( "core/block-editor" ).getBlocks();
		var blockFields = _.map(
			_.filter( blocks, function( block ) {
				return block.name.startsWith( "acf/" ) && jQuery( `[data-block="${block.clientId}"] .acf-block-preview` ).length === 1;
			} ),
			function( block ) {
				var fieldData = {
					$el: jQuery( `[data-block="${block.clientId}"] .acf-block-preview` ),
					key: block.attributes.id,
					type: "block_preview",
					name: block.name,
					post_meta_key: block.name,
				};
				innerFields.push( fieldData );
				return fieldData;
			} );
		fields = _.union( fields, blockFields );
	}

	if ( outerFields.length === 0 ) {
		return fields;
	}

	// Transform field names for nested fields.
	_.each( innerFields, function( inner ) {
		_.each( outerFields, function( outer ) {
			if ( jQuery.contains( outer.$el[ 0 ], inner.$el[ 0 ] ) ) {
				// Types that hold multiple children.
				if ( outer.type === "flexible_content" || outer.type === "repeater" ) {
					outer.children = outer.children || [];
					outer.children.push( inner );
					inner.parent = outer;
					inner.post_meta_key = outer.name + "_" + ( outer.children.length - 1 ) + "_" + inner.name;
				}

				// Types that hold single children.
				if ( outer.type === "group" ) {
					outer.children = [ inner ];
					inner.parent = outer;
					inner.post_meta_key = outer.name + "_" + inner.name;
				}
			}
		} );
	} );

	return fields;
};

},{}],6:[function(require,module,exports){
/* global _ */

var config = require( "./../config/config.js" );
var helper = require( "./../helper.js" );
var scraper_store = require( "./../scraper-store.js" );

var Collect = function() {

};

Collect.prototype.getFieldData = function() {
	var field_data = this.sort( this.filterBroken( this.filterBlacklistName( this.filterBlacklistType( this.getData() ) ) ) );

	var used_types = _.uniq( _.pluck( field_data, "type" ) );

	if ( config.debug ) {
		console.log( "Used types:" );
		console.log( used_types );
	}

	_.each( used_types, function( type ) {
		field_data = scraper_store.getScraper( type ).scrape( field_data );
	} );

	return field_data;
};

Collect.prototype.append = function( data ) {
	if ( config.debug ) {
		console.log( "Recalculate..." + new Date() );
	}

	var field_data = this.getFieldData();

	_.each( field_data, function( field ) {
		if ( typeof field.content !== "undefined" && field.content !== "" ) {
			if ( field.order < 0 ) {
				data = field.content + "\n" + data;
				return;
			}
			data += "\n" + field.content;
		}
	} );

	if ( config.debug ) {
		console.log( "Field data:" );
		console.table( field_data );

		console.log( "Data:" );
		console.log( data );
	}

	return data;
};

Collect.prototype.getData = function() {
	if ( helper.acf_version >= 5 ) {
		return require( "./collect-v5.js" )();
	}
	return require( "./collect-v4.js" );
};

Collect.prototype.filterBlacklistType = function( field_data ) {
	return _.filter( field_data, function( field ) {
		return ! _.contains( config.blacklistType, field.type );
	} );
};

Collect.prototype.filterBlacklistName = function( field_data ) {
	return _.filter( field_data, function( field ) {
		return ! _.contains( config.blacklistName, field.name );
	} );
};

Collect.prototype.filterBroken = function( field_data ) {
	return _.filter( field_data, function( field ) {
		return ( "key" in field );
	} );
};

Collect.prototype.sort = function( field_data ) {
	if ( typeof config.fieldOrder === "undefined" || ! config.fieldOrder ) {
		return field_data;
	}

	_.each( field_data, function( field ) {
		field.order = ( typeof config.fieldOrder[ field.key ] === "undefined" ) ? 0 : config.fieldOrder[ field.key ];
	} );

	return field_data.sort( function( a, b ) {
		return a.order > b.order;
	} );
};

module.exports = new Collect();

},{"./../config/config.js":7,"./../helper.js":8,"./../scraper-store.js":11,"./collect-v4.js":4,"./collect-v5.js":5}],7:[function(require,module,exports){
/* globals YoastACFAnalysisConfig */
module.exports = YoastACFAnalysisConfig;

},{}],8:[function(require,module,exports){
var config = require( "./config/config.js" );

module.exports = {
	acf_version: parseFloat( config.acfVersion, 10 ),
};

},{"./config/config.js":7}],9:[function(require,module,exports){
/* global jQuery, YoastSEO, wp, YoastACFAnalysis: true */
/* exported YoastACFAnalysis */

var App = require( "./app.js" );

wp.domReady( function() {
	if ( "undefined" !== typeof YoastSEO ) {
		YoastACFAnalysis = new App();
	}
} );

},{"./app.js":1}],10:[function(require,module,exports){
/* global _, jQuery, YoastSEO, YoastReplaceVarPlugin */

var config = require( "./config/config.js" );

var ReplaceVar = YoastReplaceVarPlugin.ReplaceVar;

var supportedTypes = [ "email", "text", "textarea", "url", "wysiwyg", "block_preview" ];

var replaceVars = {};

var replaceVarPluginAvailable = function() {
	if ( typeof ReplaceVar === "undefined" ) {
		if ( config.debug ) {
			console.log( "Replacing ACF variables in the Snippet Window requires Yoast SEO >= 5.3." );
		}

		return false;
	}

	return true;
};

var updateReplaceVars = function( collect ) {
	if ( ! replaceVarPluginAvailable() ) {
		return;
	}

	var fieldData = _.filter( collect.getFieldData(), function( field ) {
		return _.contains( supportedTypes, field.type );
	} );

	_.each( fieldData, function( field ) {
		// Remove HTML tags using jQuery in case of a wysiwyg field.
		var content = ( field.type === "wysiwyg" ) ? jQuery( jQuery.parseHTML( field.content ) ).text() : field.content;

		if ( typeof replaceVars[ field.post_meta_key ] === "undefined" ) {
			replaceVars[ field.post_meta_key ] = new ReplaceVar( "%%cf_" + field.post_meta_key + "%%", content, { source: "direct" } );
			YoastSEO.wp.replaceVarsPlugin.addReplacement( replaceVars[ field.post_meta_key ] );

			if ( config.debug ) {
				console.log( "Created ReplaceVar for: ", field.post_meta_key, " with: ", content, replaceVars[ field.post_meta_key ] );
			}
		} else {
			replaceVars[ field.post_meta_key ].replacement = content;

			if ( config.debug ) {
				console.log( "Updated ReplaceVar for: ", field.post_meta_key, " with: ", content, replaceVars[ field.post_meta_key ] );
			}
		}
	} );
};

module.exports = {
	updateReplaceVars: updateReplaceVars,
};

},{"./config/config.js":7}],11:[function(require,module,exports){
var config = require( "./config/config.js" );

var scraperObjects = {
	// Basic
	text: require( "./scraper/scraper.text.js" ),
	textarea: require( "./scraper/scraper.textarea.js" ),
	email: require( "./scraper/scraper.email.js" ),
	url: require( "./scraper/scraper.url.js" ),
	link: require( "./scraper/scraper.link.js" ),

	// Content
	wysiwyg: require( "./scraper/scraper.wysiwyg.js" ),
	// TODO: Add oembed handler
	image: require( "./scraper/scraper.image.js" ),
	gallery: require( "./scraper/scraper.gallery.js" ),
	// ACF blocks preview
	block_preview: require( "./scraper/scraper.block_preview.js" ),

	// Choice
	// TODO: select, checkbox, radio

	// Relational
	taxonomy: require( "./scraper/scraper.taxonomy.js" ),

	// Third-party / jQuery
	// TODO: google_map, date_picker, color_picker

};

var scrapers = {};

/**
 * Checks if there already is a scraper for a field type in the store.
 *
 * @param {string} type Type of scraper to find.
 *
 * @returns {boolean} True if the scraper is already defined.
 */
var hasScraper = function( type ) {
	return (
		type in scrapers
	);
};

/**
 * Set a scraper object on the store. Existing scrapers will be overwritten.
 *
 * @param {Object} scraper The scraper to add.
 * @param {string} type Type of scraper.
 *
 * @chainable
 *
 * @returns {Object} Added scraper.
 */
var setScraper = function( scraper, type ) {
	if ( config.debug && hasScraper( type ) ) {
		console.warn( "Scraper for " + type + " already exists and will be overwritten." );
	}

	scrapers[ type ] = scraper;

	return scraper;
};

/**
 * Returns the scraper object for a field type.
 * If there is no scraper object for this field type a no-op scraper is returned.
 *
 * @param {string} type Type of scraper to fetch.
 *
 * @returns {Object} The scraper for the specified type.
 */
var getScraper = function( type ) {
	if ( hasScraper( type ) ) {
		return scrapers[ type ];
	}

	if ( type in scraperObjects ) {
		return setScraper( new scraperObjects[ type ](), type );
	}

	// If we do not have a scraper just pass the fields through so it will be filtered out by the app.
	return {
		scrape: function( fields ) {
			if ( config.debug ) {
				console.warn( "No Scraper for field type: " + type );
			}
			return fields;
		},
	};
};

module.exports = {
	setScraper: setScraper,
	getScraper: getScraper,
};

},{"./config/config.js":7,"./scraper/scraper.block_preview.js":12,"./scraper/scraper.email.js":13,"./scraper/scraper.gallery.js":14,"./scraper/scraper.image.js":15,"./scraper/scraper.link.js":16,"./scraper/scraper.taxonomy.js":17,"./scraper/scraper.text.js":18,"./scraper/scraper.textarea.js":19,"./scraper/scraper.url.js":20,"./scraper/scraper.wysiwyg.js":21}],12:[function(require,module,exports){
/* global _ */

var Scraper = function() {};

Scraper.prototype.scrape = function( fields ) {
	fields = _.map( fields, function( field ) {
		if ( field.type !== "block_preview" ) {
			return field;
		}

		field.content = field.$el.html();

		return field;
	} );

	return fields;
};

module.exports = Scraper;

},{}],13:[function(require,module,exports){
/* global _ */

var Scraper = function() {};

Scraper.prototype.scrape = function( fields ) {
	fields = _.map( fields, function( field ) {
		if ( field.type !== "email" ) {
			return field;
		}

		field.content = field.$el.find( "input[type=email][id^=acf]" ).val();

		return field;
	} );

	return fields;
};

module.exports = Scraper;

},{}],14:[function(require,module,exports){
/* global _, jQuery */

var attachmentCache = require( "./../cache/cache.attachments.js" );

var Scraper = function() {};

Scraper.prototype.scrape = function( fields ) {
	var attachment_ids = [];

	fields = _.map( fields, function( field ) {
		if ( field.type !== "gallery" ) {
			return field;
		}

		field.content = "";

		field.$el.find( ".acf-gallery-attachment input[type=hidden]" ).each( function() {
			// TODO: Is this the best way to get the attachment id?
			var attachment_id = jQuery( this ).val();

			// Collect all attachment ids for cache refresh
			attachment_ids.push( attachment_id );

			// If we have the attachment data in the cache we can return a useful value
			if ( attachmentCache.get( attachment_id, "attachment" ) ) {
				var attachment = attachmentCache.get( attachment_id, "attachment" );

				field.content += '<img src="' + attachment.url + '" alt="' + attachment.alt + '" title="' + attachment.title + '">';
			}
		} );

		return field;
	} );

	attachmentCache.refresh( attachment_ids );

	return fields;
};

module.exports = Scraper;

},{"./../cache/cache.attachments.js":2}],15:[function(require,module,exports){
/* global _ */

var attachmentCache = require( "./../cache/cache.attachments.js" );

var Scraper = function() {};

Scraper.prototype.scrape = function( fields ) {
	var attachment_ids = [];

	fields = _.map( fields, function( field ) {
		if ( field.type !== "image" ) {
			return field;
		}

		field.content = "";

		var attachment_id = field.$el.find( "input[type=hidden]" ).val();

		attachment_ids.push( attachment_id );

		if ( attachmentCache.get( attachment_id, "attachment" ) ) {
			var attachment = attachmentCache.get( attachment_id, "attachment" );

			field.content += '<img src="' + attachment.url + '" alt="' + attachment.alt + '" title="' + attachment.title + '">';
		}


		return field;
	} );

	attachmentCache.refresh( attachment_ids );

	return fields;
};

module.exports = Scraper;

},{"./../cache/cache.attachments.js":2}],16:[function(require,module,exports){
/* global _ */
require( "./../scraper-store.js" );

var Scraper = function() {};

/**
 * Scraper for the link field type.
 *
 * @param {Object} fields Fields to parse.
 *
 * @returns {Object} Mapped list of fields.
 */
Scraper.prototype.scrape = function( fields ) {
	/**
	 * Set content for all link fields as a-tag with title, url and target.
	 * Return the fields object containing all fields.
	 */
	return _.map( fields, function( field ) {
		if ( field.type !== "link" ) {
			return field;
		}

		var title = field.$el.find( "input[type=hidden].input-title" ).val(),
			url = field.$el.find( "input[type=hidden].input-url" ).val(),
			target = field.$el.find( "input[type=hidden].input-target" ).val();

		field.content = "<a href=\"" + url + "\" target=\"" + target + "\">" + title + "</a>";

		return field;
	} );
};

module.exports = Scraper;

},{"./../scraper-store.js":11}],17:[function(require,module,exports){
/* global _, acf */

var Scraper = function() {};

Scraper.prototype.scrape = function( fields ) {
	fields = _.map( fields, function( field ) {
		if ( field.type !== "taxonomy" ) {
			return field;
		}

		var terms = [];

		if ( field.$el.find( '.acf-taxonomy-field[data-type="multi_select"]' ).length > 0 ) {
			var select2Target = ( acf.select2.version >= 4 ) ? "select" : "input";

			terms = _.pluck(
				field.$el.find( '.acf-taxonomy-field[data-type="multi_select"] ' + select2Target )
					.select2( "data" )
				, "text"
			);
		} else if ( field.$el.find( '.acf-taxonomy-field[data-type="checkbox"]' ).length > 0 ) {
			terms = _.pluck(
				field.$el.find( '.acf-taxonomy-field[data-type="checkbox"] input[type="checkbox"]:checked' )
					.next(),
				"textContent"
			);
		} else if ( field.$el.find( "input[type=checkbox]:checked" ).length > 0 ) {
			terms = _.pluck(
				field.$el.find( "input[type=checkbox]:checked" )
					.parent(),
				"textContent"
			);
		} else if ( field.$el.find( "select option:checked" ).length > 0 ) {
			terms = _.pluck(
				field.$el.find( "select option:checked" ),
				"textContent"
			);
		}

		terms = _.map( terms, function( term ) {
			return term.trim();
		} );

		if ( terms.length > 0 ) {
			field.content = "<ul>\n<li>" + terms.join( "</li>\n<li>" ) + "</li>\n</ul>";
		}

		return field;
	} );

	return fields;
};

module.exports = Scraper;

},{}],18:[function(require,module,exports){
/* global _ */

var config = require( "./../config/config.js" );

var Scraper = function() {};

Scraper.prototype.scrape = function( fields ) {
	var that = this;

	fields = _.map( fields, function( field ) {
		if ( field.type !== "text" ) {
			return field;
		}

		field.content = field.$el.find( "input[type=text][id^=acf]" ).val();
		field = that.wrapInHeadline( field );

		return field;
	} );

	return fields;
};

Scraper.prototype.wrapInHeadline = function( field ) {
	var level = this.isHeadline( field );
	if ( level ) {
		field.content = "<h" + level + ">" + field.content + "</h" + level + ">";
	} else {
		field.content = "<p>" + field.content + "</p>";
	}

	return field;
};

Scraper.prototype.isHeadline = function( field ) {
	var level = _.find( config.scraper.text.headlines, function( value, key ) {
		return field.key === key;
	} );

	// It has to be an integer
	if ( level ) {
		level = parseInt( level, 10 );
	}

	// Headlines only exist from h1 to h6
	if ( level < 1 || level > 6 ) {
		level = false;
	}

	return level;
};

module.exports = Scraper;

},{"./../config/config.js":7}],19:[function(require,module,exports){
/* global _ */

var Scraper = function() {};

Scraper.prototype.scrape = function( fields ) {
	fields = _.map( fields, function( field ) {
		if ( field.type !== "textarea" ) {
			return field;
		}

		field.content = "<p>" + field.$el.find( "textarea[id^=acf]" ).val() + "</p>";

		return field;
	} );

	return fields;
};

module.exports = Scraper;

},{}],20:[function(require,module,exports){
/* global _ */

var Scraper = function() {};

Scraper.prototype.scrape = function( fields ) {
	fields = _.map( fields, function( field ) {
		if ( field.type !== "url" ) {
			return field;
		}

		var content = field.$el.find( "input[type=url][id^=acf]" ).val();

		field.content = content ? '<a href="' + content + '">' + content + "</a>" : "";

		return field;
	} );

	return fields;
};

module.exports = Scraper;

},{}],21:[function(require,module,exports){
/* global tinyMCE, _ */

var Scraper = function() {};

/**
 * Adapted from wp-seo-post-scraper-plugin-310.js:196-210
 *
 * @param {string} editorID TinyMCE identifier to look up.
 *
 * @returns {boolean} True if an editor exists for the supplied ID.
 */
var isTinyMCEAvailable = function( editorID ) {
	if ( typeof tinyMCE === "undefined" ||
		 typeof tinyMCE.editors === "undefined" ||
		 tinyMCE.editors.length === 0 ||
		 tinyMCE.get( editorID ) === null ||
		 tinyMCE.get( editorID ).isHidden() ) {
		return false;
	}

	return true;
};

/**
 * Adapted from wp-seo-shortcode-plugin-305.js:115-126
 *
 * @param {Object} field Field to get the content for.
 *
 * @returns {string} The content of the field.
 */
var getContentTinyMCE = function( field ) {
	var textarea = field.$el.find( "textarea" )[ 0 ];
	var editorID = textarea.id;
	var val = textarea.value;

	if ( isTinyMCEAvailable( editorID ) ) {
		val = tinyMCE.get( editorID ) && tinyMCE.get( editorID ).getContent() || "";
	}

	return val;
};

Scraper.prototype.scrape = function( fields ) {
	fields = _.map( fields, function( field ) {
		if ( field.type !== "wysiwyg" ) {
			return field;
		}

		field.content = getContentTinyMCE( field );

		return field;
	} );

	return fields;
};

module.exports = Scraper;

},{}]},{},[9])
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJqcy9zcmMvYXBwLmpzIiwianMvc3JjL2NhY2hlL2NhY2hlLmF0dGFjaG1lbnRzLmpzIiwianMvc3JjL2NhY2hlL2NhY2hlLmpzIiwianMvc3JjL2NvbGxlY3QvY29sbGVjdC12NC5qcyIsImpzL3NyYy9jb2xsZWN0L2NvbGxlY3QtdjUuanMiLCJqcy9zcmMvY29sbGVjdC9jb2xsZWN0LmpzIiwianMvc3JjL2NvbmZpZy9jb25maWcuanMiLCJqcy9zcmMvaGVscGVyLmpzIiwianMvc3JjL21haW4uanMiLCJqcy9zcmMvcmVwbGFjZXZhcnMuanMiLCJqcy9zcmMvc2NyYXBlci1zdG9yZS5qcyIsImpzL3NyYy9zY3JhcGVyL3NjcmFwZXIuYmxvY2tfcHJldmlldy5qcyIsImpzL3NyYy9zY3JhcGVyL3NjcmFwZXIuZW1haWwuanMiLCJqcy9zcmMvc2NyYXBlci9zY3JhcGVyLmdhbGxlcnkuanMiLCJqcy9zcmMvc2NyYXBlci9zY3JhcGVyLmltYWdlLmpzIiwianMvc3JjL3NjcmFwZXIvc2NyYXBlci5saW5rLmpzIiwianMvc3JjL3NjcmFwZXIvc2NyYXBlci50YXhvbm9teS5qcyIsImpzL3NyYy9zY3JhcGVyL3NjcmFwZXIudGV4dC5qcyIsImpzL3NyYy9zY3JhcGVyL3NjcmFwZXIudGV4dGFyZWEuanMiLCJqcy9zcmMvc2NyYXBlci9zY3JhcGVyLnVybC5qcyIsImpzL3NyYy9zY3JhcGVyL3NjcmFwZXIud3lzaXd5Zy5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQTtBQ0FBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3ZGQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzlDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3BEQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3RCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN2RkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQy9GQTtBQUNBO0FBQ0E7O0FDRkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ0xBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDVkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN2REE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDaEdBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDbkJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDbkJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDeENBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3BDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNqQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdERBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNyREE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNuQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDckJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBIiwiZmlsZSI6ImdlbmVyYXRlZC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzQ29udGVudCI6WyIoZnVuY3Rpb24oKXtmdW5jdGlvbiByKGUsbix0KXtmdW5jdGlvbiBvKGksZil7aWYoIW5baV0pe2lmKCFlW2ldKXt2YXIgYz1cImZ1bmN0aW9uXCI9PXR5cGVvZiByZXF1aXJlJiZyZXF1aXJlO2lmKCFmJiZjKXJldHVybiBjKGksITApO2lmKHUpcmV0dXJuIHUoaSwhMCk7dmFyIGE9bmV3IEVycm9yKFwiQ2Fubm90IGZpbmQgbW9kdWxlICdcIitpK1wiJ1wiKTt0aHJvdyBhLmNvZGU9XCJNT0RVTEVfTk9UX0ZPVU5EXCIsYX12YXIgcD1uW2ldPXtleHBvcnRzOnt9fTtlW2ldWzBdLmNhbGwocC5leHBvcnRzLGZ1bmN0aW9uKHIpe3ZhciBuPWVbaV1bMV1bcl07cmV0dXJuIG8obnx8cil9LHAscC5leHBvcnRzLHIsZSxuLHQpfXJldHVybiBuW2ldLmV4cG9ydHN9Zm9yKHZhciB1PVwiZnVuY3Rpb25cIj09dHlwZW9mIHJlcXVpcmUmJnJlcXVpcmUsaT0wO2k8dC5sZW5ndGg7aSsrKW8odFtpXSk7cmV0dXJuIG99cmV0dXJuIHJ9KSgpIiwiLyogZ2xvYmFsIFlvYXN0U0VPLCBhY2YsIF8sIGpRdWVyeSwgd3AgKi9cbnZhciBjb25maWcgPSByZXF1aXJlKCBcIi4vY29uZmlnL2NvbmZpZy5qc1wiICk7XG52YXIgaGVscGVyID0gcmVxdWlyZSggXCIuL2hlbHBlci5qc1wiICk7XG52YXIgY29sbGVjdCA9IHJlcXVpcmUoIFwiLi9jb2xsZWN0L2NvbGxlY3QuanNcIiApO1xudmFyIHJlcGxhY2VWYXJzID0gcmVxdWlyZSggXCIuL3JlcGxhY2V2YXJzLmpzXCIgKTtcblxudmFyIGFuYWx5c2lzVGltZW91dCA9IDA7XG5cbnZhciBBcHAgPSBmdW5jdGlvbigpIHtcblx0WW9hc3RTRU8uYXBwLnJlZ2lzdGVyUGx1Z2luKCBjb25maWcucGx1Z2luTmFtZSwgeyBzdGF0dXM6IFwicmVhZHlcIiB9ICk7XG5cblx0WW9hc3RTRU8uYXBwLnJlZ2lzdGVyTW9kaWZpY2F0aW9uKCBcImNvbnRlbnRcIiwgY29sbGVjdC5hcHBlbmQuYmluZCggY29sbGVjdCApLCBjb25maWcucGx1Z2luTmFtZSApO1xuXG5cdHRoaXMuYmluZExpc3RlbmVycygpO1xufTtcblxuLyoqXG4gKiBBQ0YgNCBMaXN0ZW5lci5cbiAqXG4gKiBAcGFyYW0ge0FycmF5fSBmaWVsZFNlbGVjdG9ycyBMaXN0IG9mIGZpZWxkIHNlbGVjdG9ycy5cbiAqIEBwYXJhbSB7c3RyaW5nfSB3eXNpd3lnU2VsZWN0b3IgRWxlbWVudCBzZWxlY3RvciBmb3IgV1lTSVdZRyBmaWVsZHMuXG4gKiBAcGFyYW0ge0FycmF5fSBmaWVsZFNlbGVjdG9yc1dpdGhvdXRXeXNpd3lnIExpc3Qgb2YgZmllbGRzLlxuICpcbiAqIEByZXR1cm5zIHt2b2lkfVxuICovXG5BcHAucHJvdG90eXBlLmFjZjRMaXN0ZW5lciA9IGZ1bmN0aW9uKCBmaWVsZFNlbGVjdG9ycywgd3lzaXd5Z1NlbGVjdG9yLCBmaWVsZFNlbGVjdG9yc1dpdGhvdXRXeXNpd3lnICkge1xuXHRyZXBsYWNlVmFycy51cGRhdGVSZXBsYWNlVmFycyggY29sbGVjdCApO1xuXG5cdHZhciBmaWVsZHNXaXRob3V0V3lzaXd5ZyA9IGpRdWVyeSggXCIjcG9zdC1ib2R5LCAjZWRpdHRhZ1wiICkuZmluZCggZmllbGRTZWxlY3RvcnNXaXRob3V0V3lzaXd5Zy5qb2luKCBcIixcIiApICk7XG5cdHZhciBmaWVsZHMgPSBqUXVlcnkoIFwiI3Bvc3QtYm9keSwgI2VkaXR0YWdcIiApLmZpbmQoIGZpZWxkU2VsZWN0b3JzLmpvaW4oIFwiLFwiICkgKTtcblxuXHRmaWVsZHNXaXRob3V0V3lzaXd5Zy5vbiggXCJjaGFuZ2VcIiwgdGhpcy5tYXliZVJlZnJlc2guYmluZCggdGhpcyApICk7XG5cdC8vIERvIG5vdCBpZ25vcmUgV3lzaXd5ZyBmaWVsZHMgZm9yIHRoZSBwdXJwb3NlIG9mIFJlcGxhY2UgVmFycy5cblx0ZmllbGRzLm9uKCBcImNoYW5nZVwiLCByZXBsYWNlVmFycy51cGRhdGVSZXBsYWNlVmFycy5iaW5kKCB0aGlzLCBjb2xsZWN0ICkgKTtcblxuXHRpZiAoIFlvYXN0U0VPLndwLl90aW55TUNFSGVscGVyICkge1xuXHRcdGpRdWVyeSggd3lzaXd5Z1NlbGVjdG9yICkuZWFjaCggZnVuY3Rpb24oKSB7XG5cdFx0XHRZb2FzdFNFTy53cC5fdGlueU1DRUhlbHBlci5hZGRFdmVudEhhbmRsZXIoIHRoaXMuaWQsIFsgXCJpbnB1dFwiLCBcImNoYW5nZVwiLCBcImN1dFwiLCBcInBhc3RlXCIgXSxcblx0XHRcdFx0cmVwbGFjZVZhcnMudXBkYXRlUmVwbGFjZVZhcnMuYmluZCggdGhpcywgY29sbGVjdCApICk7XG5cdFx0fSApO1xuXHR9XG5cblx0Ly8gQWxzbyByZWZyZXNoIG9uIG1lZGlhIGNsb3NlIGFzIGF0dGFjaG1lbnQgZGF0YSBtaWdodCBoYXZlIGNoYW5nZWRcblx0d3AubWVkaWEuZnJhbWUub24oIFwiY2xvc2VcIiwgdGhpcy5tYXliZVJlZnJlc2ggKTtcbn07XG5cbi8qKlxuICogQUNGIDUgTGlzdGVuZXIuXG4gKlxuICogQHJldHVybnMge3ZvaWR9XG4gKi9cbkFwcC5wcm90b3R5cGUuYWNmNUxpc3RlbmVyID0gZnVuY3Rpb24oKSB7XG5cdHJlcGxhY2VWYXJzLnVwZGF0ZVJlcGxhY2VWYXJzKCBjb2xsZWN0ICk7XG5cblx0YWNmLmFkZF9hY3Rpb24oIFwiY2hhbmdlIHJlbW92ZSBhcHBlbmQgc29ydHN0b3BcIiwgdGhpcy5tYXliZVJlZnJlc2ggKTtcblx0YWNmLmFkZF9hY3Rpb24oIFwiY2hhbmdlIHJlbW92ZSBhcHBlbmQgc29ydHN0b3BcIiwgcmVwbGFjZVZhcnMudXBkYXRlUmVwbGFjZVZhcnMuYmluZCggdGhpcywgY29sbGVjdCApICk7XG59O1xuXG5BcHAucHJvdG90eXBlLmJpbmRMaXN0ZW5lcnMgPSBmdW5jdGlvbigpIHtcblx0aWYgKCBoZWxwZXIuYWNmX3ZlcnNpb24gPj0gNSApIHtcblx0XHRqUXVlcnkoIHRoaXMuYWNmNUxpc3RlbmVyLmJpbmQoIHRoaXMgKSApO1xuXHR9IGVsc2Uge1xuXHRcdHZhciBmaWVsZFNlbGVjdG9ycyA9IGNvbmZpZy5maWVsZFNlbGVjdG9ycy5zbGljZSggMCApO1xuXHRcdHZhciB3eXNpd3lnU2VsZWN0b3IgPSBcInRleHRhcmVhW2lkXj13eXNpd3lnLWFjZl1cIjtcblxuXHRcdC8vIElnbm9yZSBXeXNpd3lnIGZpZWxkcyBiZWNhdXNlIHRoZXkgdHJpZ2dlciBhIHJlZnJlc2ggaW4gWW9hc3QgU0VPIGl0c2VsZlxuXHRcdHZhciBmaWVsZFNlbGVjdG9yc1dpdGhvdXRXeXNpd3lnID0gXy53aXRob3V0KCBmaWVsZFNlbGVjdG9ycywgd3lzaXd5Z1NlbGVjdG9yICk7XG5cblx0XHRqUXVlcnkoIGRvY3VtZW50ICkub24oIFwiYWNmL3NldHVwX2ZpZWxkc1wiLCB0aGlzLmFjZjRMaXN0ZW5lci5iaW5kKCB0aGlzLCBmaWVsZFNlbGVjdG9ycywgd3lzaXd5Z1NlbGVjdG9yLCBmaWVsZFNlbGVjdG9yc1dpdGhvdXRXeXNpd3lnICkgKTtcblx0fVxufTtcblxuQXBwLnByb3RvdHlwZS5tYXliZVJlZnJlc2ggPSBmdW5jdGlvbigpIHtcblx0aWYgKCBhbmFseXNpc1RpbWVvdXQgKSB7XG5cdFx0d2luZG93LmNsZWFyVGltZW91dCggYW5hbHlzaXNUaW1lb3V0ICk7XG5cdH1cblxuXHRhbmFseXNpc1RpbWVvdXQgPSB3aW5kb3cuc2V0VGltZW91dCggZnVuY3Rpb24oKSB7XG5cdFx0aWYgKCBjb25maWcuZGVidWcgKSB7XG5cdFx0XHRjb25zb2xlLmxvZyggXCJSZWNhbGN1bGF0ZS4uLlwiICsgbmV3IERhdGUoKSArIFwiKEludGVybmFsKVwiICk7XG5cdFx0fVxuXG5cdFx0WW9hc3RTRU8uYXBwLnBsdWdpblJlbG9hZGVkKCBjb25maWcucGx1Z2luTmFtZSApO1xuXHR9LCBjb25maWcucmVmcmVzaFJhdGUgKTtcbn07XG5cbm1vZHVsZS5leHBvcnRzID0gQXBwO1xuIiwiLyogZ2xvYmFsIF8gKi9cbnZhciBjYWNoZSA9IHJlcXVpcmUoIFwiLi9jYWNoZS5qc1wiICk7XG5cbnZhciByZWZyZXNoID0gZnVuY3Rpb24oIGF0dGFjaG1lbnRfaWRzICkge1xuXHR2YXIgdW5jYWNoZWQgPSBjYWNoZS5nZXRVbmNhY2hlZCggYXR0YWNobWVudF9pZHMsIFwiYXR0YWNobWVudFwiICk7XG5cblx0aWYgKCB1bmNhY2hlZC5sZW5ndGggPT09IDAgKSB7XG5cdFx0cmV0dXJuO1xuXHR9XG5cblx0d2luZG93LndwLmFqYXgucG9zdCggXCJxdWVyeS1hdHRhY2htZW50c1wiLCB7XG5cdFx0cXVlcnk6IHtcblx0XHRcdHBvc3RfX2luOiB1bmNhY2hlZCxcblx0XHR9LFxuXHR9ICkuZG9uZSggZnVuY3Rpb24oIGF0dGFjaG1lbnRzICkge1xuXHRcdF8uZWFjaCggYXR0YWNobWVudHMsIGZ1bmN0aW9uKCBhdHRhY2htZW50ICkge1xuXHRcdFx0Y2FjaGUuc2V0KCBhdHRhY2htZW50LmlkLCBhdHRhY2htZW50LCBcImF0dGFjaG1lbnRcIiApO1xuXHRcdFx0d2luZG93LllvYXN0QUNGQW5hbHlzaXMubWF5YmVSZWZyZXNoKCk7XG5cdFx0fSApO1xuXHR9ICk7XG59O1xuXG52YXIgZ2V0ID0gZnVuY3Rpb24oIGlkICkge1xuXHR2YXIgYXR0YWNobWVudCA9IGNhY2hlLmdldCggaWQsIFwiYXR0YWNobWVudFwiICk7XG5cblx0aWYgKCAhIGF0dGFjaG1lbnQgKSB7XG5cdFx0cmV0dXJuIGZhbHNlO1xuXHR9XG5cblx0dmFyIGNoYW5nZWRBdHRhY2htZW50ID0gd2luZG93LndwLm1lZGlhLmF0dGFjaG1lbnQoIGlkICk7XG5cblx0aWYgKCBjaGFuZ2VkQXR0YWNobWVudC5oYXMoIFwiYWx0XCIgKSApIHtcblx0XHRhdHRhY2htZW50LmFsdCA9IGNoYW5nZWRBdHRhY2htZW50LmdldCggXCJhbHRcIiApO1xuXHR9XG5cblx0aWYgKCBjaGFuZ2VkQXR0YWNobWVudC5oYXMoIFwidGl0bGVcIiApICkge1xuXHRcdGF0dGFjaG1lbnQudGl0bGUgPSBjaGFuZ2VkQXR0YWNobWVudC5nZXQoIFwidGl0bGVcIiApO1xuXHR9XG5cblx0cmV0dXJuIGF0dGFjaG1lbnQ7XG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IHtcblx0cmVmcmVzaDogcmVmcmVzaCxcblx0Z2V0OiBnZXQsXG59O1xuIiwiLyogZ2xvYmFsIF8gKi9cbnZhciBDYWNoZSA9IGZ1bmN0aW9uKCkge1xuXHR0aGlzLmNsZWFyKCBcImFsbFwiICk7XG59O1xuXG52YXIgX2NhY2hlO1xuXG5DYWNoZS5wcm90b3R5cGUuc2V0ID0gZnVuY3Rpb24oIGlkLCB2YWx1ZSwgc3RvcmUgKSB7XG5cdHN0b3JlID0gdHlwZW9mIHN0b3JlID09PSBcInVuZGVmaW5lZFwiID8gXCJkZWZhdWx0XCIgOiBzdG9yZTtcblxuXHRpZiAoICEgKCBzdG9yZSBpbiBfY2FjaGUgKSApIHtcblx0XHRfY2FjaGVbIHN0b3JlIF0gPSB7fTtcblx0fVxuXG5cdF9jYWNoZVsgc3RvcmUgXVsgaWQgXSA9IHZhbHVlO1xufTtcblxuQ2FjaGUucHJvdG90eXBlLmdldCA9ICBmdW5jdGlvbiggaWQsIHN0b3JlICkge1xuXHRzdG9yZSA9IHR5cGVvZiBzdG9yZSA9PT0gXCJ1bmRlZmluZWRcIiA/IFwiZGVmYXVsdFwiIDogc3RvcmU7XG5cblx0aWYgKCBzdG9yZSBpbiBfY2FjaGUgJiYgaWQgaW4gX2NhY2hlWyBzdG9yZSBdICkge1xuXHRcdHJldHVybiBfY2FjaGVbIHN0b3JlIF1bIGlkIF07XG5cdH1cblxuXHRyZXR1cm4gZmFsc2U7XG59O1xuXG5DYWNoZS5wcm90b3R5cGUuZ2V0VW5jYWNoZWQgPSAgZnVuY3Rpb24oIGlkcywgc3RvcmUgKSB7XG5cdHN0b3JlID0gdHlwZW9mIHN0b3JlID09PSBcInVuZGVmaW5lZFwiID8gXCJkZWZhdWx0XCIgOiBzdG9yZTtcblxuXHR2YXIgdGhhdCA9IHRoaXM7XG5cblx0aWRzID0gXy51bmlxKCBpZHMgKTtcblxuXHRyZXR1cm4gaWRzLmZpbHRlciggZnVuY3Rpb24oIGlkICkge1xuXHRcdHZhciB2YWx1ZSA9IHRoYXQuZ2V0KCBpZCwgc3RvcmUgKTtcblxuXHRcdHJldHVybiB2YWx1ZSA9PT0gZmFsc2U7XG5cdH0gKTtcbn07XG5cbkNhY2hlLnByb3RvdHlwZS5jbGVhciA9ICBmdW5jdGlvbiggc3RvcmUgKSB7XG5cdHN0b3JlID0gdHlwZW9mIHN0b3JlID09PSBcInVuZGVmaW5lZFwiID8gXCJkZWZhdWx0XCIgOiBzdG9yZTtcblxuXHRpZiAoIHN0b3JlID09PSBcImFsbFwiICkge1xuXHRcdF9jYWNoZSA9IHt9O1xuXHR9IGVsc2Uge1xuXHRcdF9jYWNoZVsgc3RvcmUgXSA9IHt9O1xuXHR9XG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IG5ldyBDYWNoZSgpO1xuIiwiLyogZ2xvYmFsIGpRdWVyeSAqL1xuXG52YXIgY29uZmlnID0gcmVxdWlyZSggXCIuLy4uL2NvbmZpZy9jb25maWcuanNcIiApO1xudmFyIGZpZWxkU2VsZWN0b3JzID0gY29uZmlnLmZpZWxkU2VsZWN0b3JzO1xuXG52YXIgZmllbGRfZGF0YSA9IFtdO1xuXG52YXIgZmllbGRzID0galF1ZXJ5KCBcIiNwb3N0LWJvZHksICNlZGl0dGFnXCIgKS5maW5kKCBmaWVsZFNlbGVjdG9ycy5qb2luKCBcIixcIiApICk7XG5cbmZpZWxkcy5lYWNoKCBmdW5jdGlvbigpIHtcblx0dmFyICRlbCA9IGpRdWVyeSggdGhpcyApLnBhcmVudHMoIFwiLmZpZWxkXCIgKS5sYXN0KCk7XG5cblx0ZmllbGRfZGF0YS5wdXNoKCB7XG5cdFx0JGVsOiAkZWwsXG5cdFx0a2V5OiAkZWwuZGF0YSggXCJmaWVsZF9rZXlcIiApLFxuXHRcdG5hbWU6ICRlbC5kYXRhKCBcImZpZWxkX25hbWVcIiApLFxuXHRcdHR5cGU6ICRlbC5kYXRhKCBcImZpZWxkX3R5cGVcIiApLFxuXHRcdHBvc3RfbWV0YV9rZXk6ICRlbC5kYXRhKCBcImZpZWxkX25hbWVcIiApLFxuXHR9ICk7XG59ICk7XG5cbm1vZHVsZS5leHBvcnRzID0gZmllbGRfZGF0YTtcbiIsIi8qIGdsb2JhbCBfLCBhY2YsIGpRdWVyeSwgd3AgKi9cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24oKSB7XG5cdHZhciBvdXRlckZpZWxkc05hbWUgPSBbXG5cdFx0XCJmbGV4aWJsZV9jb250ZW50XCIsXG5cdFx0XCJyZXBlYXRlclwiLFxuXHRcdFwiZ3JvdXBcIixcblx0XTtcblxuXHR2YXIgaW5uZXJGaWVsZHMgPSBbXTtcblx0dmFyIG91dGVyRmllbGRzID0gW107XG5cdHZhciBhY2ZGaWVsZHMgPSBbXTtcblxuXHRpZiAoIHdwLmRhdGEuc2VsZWN0KCBcImNvcmUvYmxvY2stZWRpdG9yXCIgKSApIHtcblx0XHQvLyBSZXR1cm4gb25seSBmaWVsZHMgaW4gbWV0YWJveCBhcmVhcyAoZWl0aGVyIGJlbG93IG9yIHNpZGUpIG9yXG5cdFx0Ly8gQUNGIGJsb2NrIGZpZWxkcyBpbiB0aGUgY29udGVudCAobm90IGluIHRoZSBzaWRlYmFyLCB0byBwcmV2ZW50IGR1cGxpY2F0ZXMpXG5cdFx0dmFyIHBhcmVudENvbnRhaW5lciA9IGpRdWVyeSggXCIubWV0YWJveC1sb2NhdGlvbi1ub3JtYWwsIC5tZXRhYm94LWxvY2F0aW9uLXNpZGUsIC5hY2YtYmxvY2stY29tcG9uZW50LmFjZi1ibG9jay1ib2R5XCIgKTtcblx0XHRhY2ZGaWVsZHMgPSBhY2YuZ2V0X2ZpZWxkcyggZmFsc2UsIHBhcmVudENvbnRhaW5lciApO1xuXHR9IGVsc2Uge1xuXHRcdGFjZkZpZWxkcyA9IGFjZi5nZXRfZmllbGRzKCk7XG5cdH1cblxuXHR2YXIgZmllbGRzID0gXy5tYXAoIGFjZkZpZWxkcywgZnVuY3Rpb24oIGZpZWxkICkge1xuXHRcdHZhciBmaWVsZERhdGEgPSBqUXVlcnkuZXh0ZW5kKCB0cnVlLCB7fSwgYWNmLmdldF9kYXRhKCBqUXVlcnkoIGZpZWxkICkgKSApO1xuXHRcdGZpZWxkRGF0YS4kZWwgPSBqUXVlcnkoIGZpZWxkICk7XG5cdFx0ZmllbGREYXRhLnBvc3RfbWV0YV9rZXkgPSBmaWVsZERhdGEubmFtZTtcblxuXHRcdC8vIENvbGxlY3QgbmVzdGVkIGFuZCBwYXJlbnRcblx0XHRpZiAoIG91dGVyRmllbGRzTmFtZS5pbmRleE9mKCBmaWVsZERhdGEudHlwZSApID09PSAtMSApIHtcblx0XHRcdGlubmVyRmllbGRzLnB1c2goIGZpZWxkRGF0YSApO1xuXHRcdH0gZWxzZSB7XG5cdFx0XHRvdXRlckZpZWxkcy5wdXNoKCBmaWVsZERhdGEgKTtcblx0XHR9XG5cblx0XHRyZXR1cm4gZmllbGREYXRhO1xuXHR9ICk7XG5cblx0Ly8gQWRkIEFDRiBibG9jayBwcmV2aWV3cywgdGhleSBhcmUgbm90IHJldHVybmVkIGJ5IGFjZi5nZXRfZmllbGRzKClcblx0Ly8gRmlyc3QgY2hlY2sgaWYgd2UgY2FuIHVzZSBHdXRlbmJlcmcuXG5cdGlmICggd3AuZGF0YS5zZWxlY3QoIFwiY29yZS9ibG9jay1lZGl0b3JcIiApICkge1xuXHRcdC8vIEd1dGVuYmVyZyBpcyBhdmFpbGFibGUuXG5cdFx0dmFyIGJsb2NrcyA9IHdwLmRhdGEuc2VsZWN0KCBcImNvcmUvYmxvY2stZWRpdG9yXCIgKS5nZXRCbG9ja3MoKTtcblx0XHR2YXIgYmxvY2tGaWVsZHMgPSBfLm1hcChcblx0XHRcdF8uZmlsdGVyKCBibG9ja3MsIGZ1bmN0aW9uKCBibG9jayApIHtcblx0XHRcdFx0cmV0dXJuIGJsb2NrLm5hbWUuc3RhcnRzV2l0aCggXCJhY2YvXCIgKSAmJiBqUXVlcnkoIGBbZGF0YS1ibG9jaz1cIiR7YmxvY2suY2xpZW50SWR9XCJdIC5hY2YtYmxvY2stcHJldmlld2AgKS5sZW5ndGggPT09IDE7XG5cdFx0XHR9ICksXG5cdFx0XHRmdW5jdGlvbiggYmxvY2sgKSB7XG5cdFx0XHRcdHZhciBmaWVsZERhdGEgPSB7XG5cdFx0XHRcdFx0JGVsOiBqUXVlcnkoIGBbZGF0YS1ibG9jaz1cIiR7YmxvY2suY2xpZW50SWR9XCJdIC5hY2YtYmxvY2stcHJldmlld2AgKSxcblx0XHRcdFx0XHRrZXk6IGJsb2NrLmF0dHJpYnV0ZXMuaWQsXG5cdFx0XHRcdFx0dHlwZTogXCJibG9ja19wcmV2aWV3XCIsXG5cdFx0XHRcdFx0bmFtZTogYmxvY2submFtZSxcblx0XHRcdFx0XHRwb3N0X21ldGFfa2V5OiBibG9jay5uYW1lLFxuXHRcdFx0XHR9O1xuXHRcdFx0XHRpbm5lckZpZWxkcy5wdXNoKCBmaWVsZERhdGEgKTtcblx0XHRcdFx0cmV0dXJuIGZpZWxkRGF0YTtcblx0XHRcdH0gKTtcblx0XHRmaWVsZHMgPSBfLnVuaW9uKCBmaWVsZHMsIGJsb2NrRmllbGRzICk7XG5cdH1cblxuXHRpZiAoIG91dGVyRmllbGRzLmxlbmd0aCA9PT0gMCApIHtcblx0XHRyZXR1cm4gZmllbGRzO1xuXHR9XG5cblx0Ly8gVHJhbnNmb3JtIGZpZWxkIG5hbWVzIGZvciBuZXN0ZWQgZmllbGRzLlxuXHRfLmVhY2goIGlubmVyRmllbGRzLCBmdW5jdGlvbiggaW5uZXIgKSB7XG5cdFx0Xy5lYWNoKCBvdXRlckZpZWxkcywgZnVuY3Rpb24oIG91dGVyICkge1xuXHRcdFx0aWYgKCBqUXVlcnkuY29udGFpbnMoIG91dGVyLiRlbFsgMCBdLCBpbm5lci4kZWxbIDAgXSApICkge1xuXHRcdFx0XHQvLyBUeXBlcyB0aGF0IGhvbGQgbXVsdGlwbGUgY2hpbGRyZW4uXG5cdFx0XHRcdGlmICggb3V0ZXIudHlwZSA9PT0gXCJmbGV4aWJsZV9jb250ZW50XCIgfHwgb3V0ZXIudHlwZSA9PT0gXCJyZXBlYXRlclwiICkge1xuXHRcdFx0XHRcdG91dGVyLmNoaWxkcmVuID0gb3V0ZXIuY2hpbGRyZW4gfHwgW107XG5cdFx0XHRcdFx0b3V0ZXIuY2hpbGRyZW4ucHVzaCggaW5uZXIgKTtcblx0XHRcdFx0XHRpbm5lci5wYXJlbnQgPSBvdXRlcjtcblx0XHRcdFx0XHRpbm5lci5wb3N0X21ldGFfa2V5ID0gb3V0ZXIubmFtZSArIFwiX1wiICsgKCBvdXRlci5jaGlsZHJlbi5sZW5ndGggLSAxICkgKyBcIl9cIiArIGlubmVyLm5hbWU7XG5cdFx0XHRcdH1cblxuXHRcdFx0XHQvLyBUeXBlcyB0aGF0IGhvbGQgc2luZ2xlIGNoaWxkcmVuLlxuXHRcdFx0XHRpZiAoIG91dGVyLnR5cGUgPT09IFwiZ3JvdXBcIiApIHtcblx0XHRcdFx0XHRvdXRlci5jaGlsZHJlbiA9IFsgaW5uZXIgXTtcblx0XHRcdFx0XHRpbm5lci5wYXJlbnQgPSBvdXRlcjtcblx0XHRcdFx0XHRpbm5lci5wb3N0X21ldGFfa2V5ID0gb3V0ZXIubmFtZSArIFwiX1wiICsgaW5uZXIubmFtZTtcblx0XHRcdFx0fVxuXHRcdFx0fVxuXHRcdH0gKTtcblx0fSApO1xuXG5cdHJldHVybiBmaWVsZHM7XG59O1xuIiwiLyogZ2xvYmFsIF8gKi9cblxudmFyIGNvbmZpZyA9IHJlcXVpcmUoIFwiLi8uLi9jb25maWcvY29uZmlnLmpzXCIgKTtcbnZhciBoZWxwZXIgPSByZXF1aXJlKCBcIi4vLi4vaGVscGVyLmpzXCIgKTtcbnZhciBzY3JhcGVyX3N0b3JlID0gcmVxdWlyZSggXCIuLy4uL3NjcmFwZXItc3RvcmUuanNcIiApO1xuXG52YXIgQ29sbGVjdCA9IGZ1bmN0aW9uKCkge1xuXG59O1xuXG5Db2xsZWN0LnByb3RvdHlwZS5nZXRGaWVsZERhdGEgPSBmdW5jdGlvbigpIHtcblx0dmFyIGZpZWxkX2RhdGEgPSB0aGlzLnNvcnQoIHRoaXMuZmlsdGVyQnJva2VuKCB0aGlzLmZpbHRlckJsYWNrbGlzdE5hbWUoIHRoaXMuZmlsdGVyQmxhY2tsaXN0VHlwZSggdGhpcy5nZXREYXRhKCkgKSApICkgKTtcblxuXHR2YXIgdXNlZF90eXBlcyA9IF8udW5pcSggXy5wbHVjayggZmllbGRfZGF0YSwgXCJ0eXBlXCIgKSApO1xuXG5cdGlmICggY29uZmlnLmRlYnVnICkge1xuXHRcdGNvbnNvbGUubG9nKCBcIlVzZWQgdHlwZXM6XCIgKTtcblx0XHRjb25zb2xlLmxvZyggdXNlZF90eXBlcyApO1xuXHR9XG5cblx0Xy5lYWNoKCB1c2VkX3R5cGVzLCBmdW5jdGlvbiggdHlwZSApIHtcblx0XHRmaWVsZF9kYXRhID0gc2NyYXBlcl9zdG9yZS5nZXRTY3JhcGVyKCB0eXBlICkuc2NyYXBlKCBmaWVsZF9kYXRhICk7XG5cdH0gKTtcblxuXHRyZXR1cm4gZmllbGRfZGF0YTtcbn07XG5cbkNvbGxlY3QucHJvdG90eXBlLmFwcGVuZCA9IGZ1bmN0aW9uKCBkYXRhICkge1xuXHRpZiAoIGNvbmZpZy5kZWJ1ZyApIHtcblx0XHRjb25zb2xlLmxvZyggXCJSZWNhbGN1bGF0ZS4uLlwiICsgbmV3IERhdGUoKSApO1xuXHR9XG5cblx0dmFyIGZpZWxkX2RhdGEgPSB0aGlzLmdldEZpZWxkRGF0YSgpO1xuXG5cdF8uZWFjaCggZmllbGRfZGF0YSwgZnVuY3Rpb24oIGZpZWxkICkge1xuXHRcdGlmICggdHlwZW9mIGZpZWxkLmNvbnRlbnQgIT09IFwidW5kZWZpbmVkXCIgJiYgZmllbGQuY29udGVudCAhPT0gXCJcIiApIHtcblx0XHRcdGlmICggZmllbGQub3JkZXIgPCAwICkge1xuXHRcdFx0XHRkYXRhID0gZmllbGQuY29udGVudCArIFwiXFxuXCIgKyBkYXRhO1xuXHRcdFx0XHRyZXR1cm47XG5cdFx0XHR9XG5cdFx0XHRkYXRhICs9IFwiXFxuXCIgKyBmaWVsZC5jb250ZW50O1xuXHRcdH1cblx0fSApO1xuXG5cdGlmICggY29uZmlnLmRlYnVnICkge1xuXHRcdGNvbnNvbGUubG9nKCBcIkZpZWxkIGRhdGE6XCIgKTtcblx0XHRjb25zb2xlLnRhYmxlKCBmaWVsZF9kYXRhICk7XG5cblx0XHRjb25zb2xlLmxvZyggXCJEYXRhOlwiICk7XG5cdFx0Y29uc29sZS5sb2coIGRhdGEgKTtcblx0fVxuXG5cdHJldHVybiBkYXRhO1xufTtcblxuQ29sbGVjdC5wcm90b3R5cGUuZ2V0RGF0YSA9IGZ1bmN0aW9uKCkge1xuXHRpZiAoIGhlbHBlci5hY2ZfdmVyc2lvbiA+PSA1ICkge1xuXHRcdHJldHVybiByZXF1aXJlKCBcIi4vY29sbGVjdC12NS5qc1wiICkoKTtcblx0fVxuXHRyZXR1cm4gcmVxdWlyZSggXCIuL2NvbGxlY3QtdjQuanNcIiApO1xufTtcblxuQ29sbGVjdC5wcm90b3R5cGUuZmlsdGVyQmxhY2tsaXN0VHlwZSA9IGZ1bmN0aW9uKCBmaWVsZF9kYXRhICkge1xuXHRyZXR1cm4gXy5maWx0ZXIoIGZpZWxkX2RhdGEsIGZ1bmN0aW9uKCBmaWVsZCApIHtcblx0XHRyZXR1cm4gISBfLmNvbnRhaW5zKCBjb25maWcuYmxhY2tsaXN0VHlwZSwgZmllbGQudHlwZSApO1xuXHR9ICk7XG59O1xuXG5Db2xsZWN0LnByb3RvdHlwZS5maWx0ZXJCbGFja2xpc3ROYW1lID0gZnVuY3Rpb24oIGZpZWxkX2RhdGEgKSB7XG5cdHJldHVybiBfLmZpbHRlciggZmllbGRfZGF0YSwgZnVuY3Rpb24oIGZpZWxkICkge1xuXHRcdHJldHVybiAhIF8uY29udGFpbnMoIGNvbmZpZy5ibGFja2xpc3ROYW1lLCBmaWVsZC5uYW1lICk7XG5cdH0gKTtcbn07XG5cbkNvbGxlY3QucHJvdG90eXBlLmZpbHRlckJyb2tlbiA9IGZ1bmN0aW9uKCBmaWVsZF9kYXRhICkge1xuXHRyZXR1cm4gXy5maWx0ZXIoIGZpZWxkX2RhdGEsIGZ1bmN0aW9uKCBmaWVsZCApIHtcblx0XHRyZXR1cm4gKCBcImtleVwiIGluIGZpZWxkICk7XG5cdH0gKTtcbn07XG5cbkNvbGxlY3QucHJvdG90eXBlLnNvcnQgPSBmdW5jdGlvbiggZmllbGRfZGF0YSApIHtcblx0aWYgKCB0eXBlb2YgY29uZmlnLmZpZWxkT3JkZXIgPT09IFwidW5kZWZpbmVkXCIgfHwgISBjb25maWcuZmllbGRPcmRlciApIHtcblx0XHRyZXR1cm4gZmllbGRfZGF0YTtcblx0fVxuXG5cdF8uZWFjaCggZmllbGRfZGF0YSwgZnVuY3Rpb24oIGZpZWxkICkge1xuXHRcdGZpZWxkLm9yZGVyID0gKCB0eXBlb2YgY29uZmlnLmZpZWxkT3JkZXJbIGZpZWxkLmtleSBdID09PSBcInVuZGVmaW5lZFwiICkgPyAwIDogY29uZmlnLmZpZWxkT3JkZXJbIGZpZWxkLmtleSBdO1xuXHR9ICk7XG5cblx0cmV0dXJuIGZpZWxkX2RhdGEuc29ydCggZnVuY3Rpb24oIGEsIGIgKSB7XG5cdFx0cmV0dXJuIGEub3JkZXIgPiBiLm9yZGVyO1xuXHR9ICk7XG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IG5ldyBDb2xsZWN0KCk7XG4iLCIvKiBnbG9iYWxzIFlvYXN0QUNGQW5hbHlzaXNDb25maWcgKi9cbm1vZHVsZS5leHBvcnRzID0gWW9hc3RBQ0ZBbmFseXNpc0NvbmZpZztcbiIsInZhciBjb25maWcgPSByZXF1aXJlKCBcIi4vY29uZmlnL2NvbmZpZy5qc1wiICk7XG5cbm1vZHVsZS5leHBvcnRzID0ge1xuXHRhY2ZfdmVyc2lvbjogcGFyc2VGbG9hdCggY29uZmlnLmFjZlZlcnNpb24sIDEwICksXG59O1xuIiwiLyogZ2xvYmFsIGpRdWVyeSwgWW9hc3RTRU8sIHdwLCBZb2FzdEFDRkFuYWx5c2lzOiB0cnVlICovXG4vKiBleHBvcnRlZCBZb2FzdEFDRkFuYWx5c2lzICovXG5cbnZhciBBcHAgPSByZXF1aXJlKCBcIi4vYXBwLmpzXCIgKTtcblxud3AuZG9tUmVhZHkoIGZ1bmN0aW9uKCkge1xuXHRpZiAoIFwidW5kZWZpbmVkXCIgIT09IHR5cGVvZiBZb2FzdFNFTyApIHtcblx0XHRZb2FzdEFDRkFuYWx5c2lzID0gbmV3IEFwcCgpO1xuXHR9XG59ICk7XG4iLCIvKiBnbG9iYWwgXywgalF1ZXJ5LCBZb2FzdFNFTywgWW9hc3RSZXBsYWNlVmFyUGx1Z2luICovXG5cbnZhciBjb25maWcgPSByZXF1aXJlKCBcIi4vY29uZmlnL2NvbmZpZy5qc1wiICk7XG5cbnZhciBSZXBsYWNlVmFyID0gWW9hc3RSZXBsYWNlVmFyUGx1Z2luLlJlcGxhY2VWYXI7XG5cbnZhciBzdXBwb3J0ZWRUeXBlcyA9IFsgXCJlbWFpbFwiLCBcInRleHRcIiwgXCJ0ZXh0YXJlYVwiLCBcInVybFwiLCBcInd5c2l3eWdcIiwgXCJibG9ja19wcmV2aWV3XCIgXTtcblxudmFyIHJlcGxhY2VWYXJzID0ge307XG5cbnZhciByZXBsYWNlVmFyUGx1Z2luQXZhaWxhYmxlID0gZnVuY3Rpb24oKSB7XG5cdGlmICggdHlwZW9mIFJlcGxhY2VWYXIgPT09IFwidW5kZWZpbmVkXCIgKSB7XG5cdFx0aWYgKCBjb25maWcuZGVidWcgKSB7XG5cdFx0XHRjb25zb2xlLmxvZyggXCJSZXBsYWNpbmcgQUNGIHZhcmlhYmxlcyBpbiB0aGUgU25pcHBldCBXaW5kb3cgcmVxdWlyZXMgWW9hc3QgU0VPID49IDUuMy5cIiApO1xuXHRcdH1cblxuXHRcdHJldHVybiBmYWxzZTtcblx0fVxuXG5cdHJldHVybiB0cnVlO1xufTtcblxudmFyIHVwZGF0ZVJlcGxhY2VWYXJzID0gZnVuY3Rpb24oIGNvbGxlY3QgKSB7XG5cdGlmICggISByZXBsYWNlVmFyUGx1Z2luQXZhaWxhYmxlKCkgKSB7XG5cdFx0cmV0dXJuO1xuXHR9XG5cblx0dmFyIGZpZWxkRGF0YSA9IF8uZmlsdGVyKCBjb2xsZWN0LmdldEZpZWxkRGF0YSgpLCBmdW5jdGlvbiggZmllbGQgKSB7XG5cdFx0cmV0dXJuIF8uY29udGFpbnMoIHN1cHBvcnRlZFR5cGVzLCBmaWVsZC50eXBlICk7XG5cdH0gKTtcblxuXHRfLmVhY2goIGZpZWxkRGF0YSwgZnVuY3Rpb24oIGZpZWxkICkge1xuXHRcdC8vIFJlbW92ZSBIVE1MIHRhZ3MgdXNpbmcgalF1ZXJ5IGluIGNhc2Ugb2YgYSB3eXNpd3lnIGZpZWxkLlxuXHRcdHZhciBjb250ZW50ID0gKCBmaWVsZC50eXBlID09PSBcInd5c2l3eWdcIiApID8galF1ZXJ5KCBqUXVlcnkucGFyc2VIVE1MKCBmaWVsZC5jb250ZW50ICkgKS50ZXh0KCkgOiBmaWVsZC5jb250ZW50O1xuXG5cdFx0aWYgKCB0eXBlb2YgcmVwbGFjZVZhcnNbIGZpZWxkLnBvc3RfbWV0YV9rZXkgXSA9PT0gXCJ1bmRlZmluZWRcIiApIHtcblx0XHRcdHJlcGxhY2VWYXJzWyBmaWVsZC5wb3N0X21ldGFfa2V5IF0gPSBuZXcgUmVwbGFjZVZhciggXCIlJWNmX1wiICsgZmllbGQucG9zdF9tZXRhX2tleSArIFwiJSVcIiwgY29udGVudCwgeyBzb3VyY2U6IFwiZGlyZWN0XCIgfSApO1xuXHRcdFx0WW9hc3RTRU8ud3AucmVwbGFjZVZhcnNQbHVnaW4uYWRkUmVwbGFjZW1lbnQoIHJlcGxhY2VWYXJzWyBmaWVsZC5wb3N0X21ldGFfa2V5IF0gKTtcblxuXHRcdFx0aWYgKCBjb25maWcuZGVidWcgKSB7XG5cdFx0XHRcdGNvbnNvbGUubG9nKCBcIkNyZWF0ZWQgUmVwbGFjZVZhciBmb3I6IFwiLCBmaWVsZC5wb3N0X21ldGFfa2V5LCBcIiB3aXRoOiBcIiwgY29udGVudCwgcmVwbGFjZVZhcnNbIGZpZWxkLnBvc3RfbWV0YV9rZXkgXSApO1xuXHRcdFx0fVxuXHRcdH0gZWxzZSB7XG5cdFx0XHRyZXBsYWNlVmFyc1sgZmllbGQucG9zdF9tZXRhX2tleSBdLnJlcGxhY2VtZW50ID0gY29udGVudDtcblxuXHRcdFx0aWYgKCBjb25maWcuZGVidWcgKSB7XG5cdFx0XHRcdGNvbnNvbGUubG9nKCBcIlVwZGF0ZWQgUmVwbGFjZVZhciBmb3I6IFwiLCBmaWVsZC5wb3N0X21ldGFfa2V5LCBcIiB3aXRoOiBcIiwgY29udGVudCwgcmVwbGFjZVZhcnNbIGZpZWxkLnBvc3RfbWV0YV9rZXkgXSApO1xuXHRcdFx0fVxuXHRcdH1cblx0fSApO1xufTtcblxubW9kdWxlLmV4cG9ydHMgPSB7XG5cdHVwZGF0ZVJlcGxhY2VWYXJzOiB1cGRhdGVSZXBsYWNlVmFycyxcbn07XG4iLCJ2YXIgY29uZmlnID0gcmVxdWlyZSggXCIuL2NvbmZpZy9jb25maWcuanNcIiApO1xuXG52YXIgc2NyYXBlck9iamVjdHMgPSB7XG5cdC8vIEJhc2ljXG5cdHRleHQ6IHJlcXVpcmUoIFwiLi9zY3JhcGVyL3NjcmFwZXIudGV4dC5qc1wiICksXG5cdHRleHRhcmVhOiByZXF1aXJlKCBcIi4vc2NyYXBlci9zY3JhcGVyLnRleHRhcmVhLmpzXCIgKSxcblx0ZW1haWw6IHJlcXVpcmUoIFwiLi9zY3JhcGVyL3NjcmFwZXIuZW1haWwuanNcIiApLFxuXHR1cmw6IHJlcXVpcmUoIFwiLi9zY3JhcGVyL3NjcmFwZXIudXJsLmpzXCIgKSxcblx0bGluazogcmVxdWlyZSggXCIuL3NjcmFwZXIvc2NyYXBlci5saW5rLmpzXCIgKSxcblxuXHQvLyBDb250ZW50XG5cdHd5c2l3eWc6IHJlcXVpcmUoIFwiLi9zY3JhcGVyL3NjcmFwZXIud3lzaXd5Zy5qc1wiICksXG5cdC8vIFRPRE86IEFkZCBvZW1iZWQgaGFuZGxlclxuXHRpbWFnZTogcmVxdWlyZSggXCIuL3NjcmFwZXIvc2NyYXBlci5pbWFnZS5qc1wiICksXG5cdGdhbGxlcnk6IHJlcXVpcmUoIFwiLi9zY3JhcGVyL3NjcmFwZXIuZ2FsbGVyeS5qc1wiICksXG5cdC8vIEFDRiBibG9ja3MgcHJldmlld1xuXHRibG9ja19wcmV2aWV3OiByZXF1aXJlKCBcIi4vc2NyYXBlci9zY3JhcGVyLmJsb2NrX3ByZXZpZXcuanNcIiApLFxuXG5cdC8vIENob2ljZVxuXHQvLyBUT0RPOiBzZWxlY3QsIGNoZWNrYm94LCByYWRpb1xuXG5cdC8vIFJlbGF0aW9uYWxcblx0dGF4b25vbXk6IHJlcXVpcmUoIFwiLi9zY3JhcGVyL3NjcmFwZXIudGF4b25vbXkuanNcIiApLFxuXG5cdC8vIFRoaXJkLXBhcnR5IC8galF1ZXJ5XG5cdC8vIFRPRE86IGdvb2dsZV9tYXAsIGRhdGVfcGlja2VyLCBjb2xvcl9waWNrZXJcblxufTtcblxudmFyIHNjcmFwZXJzID0ge307XG5cbi8qKlxuICogQ2hlY2tzIGlmIHRoZXJlIGFscmVhZHkgaXMgYSBzY3JhcGVyIGZvciBhIGZpZWxkIHR5cGUgaW4gdGhlIHN0b3JlLlxuICpcbiAqIEBwYXJhbSB7c3RyaW5nfSB0eXBlIFR5cGUgb2Ygc2NyYXBlciB0byBmaW5kLlxuICpcbiAqIEByZXR1cm5zIHtib29sZWFufSBUcnVlIGlmIHRoZSBzY3JhcGVyIGlzIGFscmVhZHkgZGVmaW5lZC5cbiAqL1xudmFyIGhhc1NjcmFwZXIgPSBmdW5jdGlvbiggdHlwZSApIHtcblx0cmV0dXJuIChcblx0XHR0eXBlIGluIHNjcmFwZXJzXG5cdCk7XG59O1xuXG4vKipcbiAqIFNldCBhIHNjcmFwZXIgb2JqZWN0IG9uIHRoZSBzdG9yZS4gRXhpc3Rpbmcgc2NyYXBlcnMgd2lsbCBiZSBvdmVyd3JpdHRlbi5cbiAqXG4gKiBAcGFyYW0ge09iamVjdH0gc2NyYXBlciBUaGUgc2NyYXBlciB0byBhZGQuXG4gKiBAcGFyYW0ge3N0cmluZ30gdHlwZSBUeXBlIG9mIHNjcmFwZXIuXG4gKlxuICogQGNoYWluYWJsZVxuICpcbiAqIEByZXR1cm5zIHtPYmplY3R9IEFkZGVkIHNjcmFwZXIuXG4gKi9cbnZhciBzZXRTY3JhcGVyID0gZnVuY3Rpb24oIHNjcmFwZXIsIHR5cGUgKSB7XG5cdGlmICggY29uZmlnLmRlYnVnICYmIGhhc1NjcmFwZXIoIHR5cGUgKSApIHtcblx0XHRjb25zb2xlLndhcm4oIFwiU2NyYXBlciBmb3IgXCIgKyB0eXBlICsgXCIgYWxyZWFkeSBleGlzdHMgYW5kIHdpbGwgYmUgb3ZlcndyaXR0ZW4uXCIgKTtcblx0fVxuXG5cdHNjcmFwZXJzWyB0eXBlIF0gPSBzY3JhcGVyO1xuXG5cdHJldHVybiBzY3JhcGVyO1xufTtcblxuLyoqXG4gKiBSZXR1cm5zIHRoZSBzY3JhcGVyIG9iamVjdCBmb3IgYSBmaWVsZCB0eXBlLlxuICogSWYgdGhlcmUgaXMgbm8gc2NyYXBlciBvYmplY3QgZm9yIHRoaXMgZmllbGQgdHlwZSBhIG5vLW9wIHNjcmFwZXIgaXMgcmV0dXJuZWQuXG4gKlxuICogQHBhcmFtIHtzdHJpbmd9IHR5cGUgVHlwZSBvZiBzY3JhcGVyIHRvIGZldGNoLlxuICpcbiAqIEByZXR1cm5zIHtPYmplY3R9IFRoZSBzY3JhcGVyIGZvciB0aGUgc3BlY2lmaWVkIHR5cGUuXG4gKi9cbnZhciBnZXRTY3JhcGVyID0gZnVuY3Rpb24oIHR5cGUgKSB7XG5cdGlmICggaGFzU2NyYXBlciggdHlwZSApICkge1xuXHRcdHJldHVybiBzY3JhcGVyc1sgdHlwZSBdO1xuXHR9XG5cblx0aWYgKCB0eXBlIGluIHNjcmFwZXJPYmplY3RzICkge1xuXHRcdHJldHVybiBzZXRTY3JhcGVyKCBuZXcgc2NyYXBlck9iamVjdHNbIHR5cGUgXSgpLCB0eXBlICk7XG5cdH1cblxuXHQvLyBJZiB3ZSBkbyBub3QgaGF2ZSBhIHNjcmFwZXIganVzdCBwYXNzIHRoZSBmaWVsZHMgdGhyb3VnaCBzbyBpdCB3aWxsIGJlIGZpbHRlcmVkIG91dCBieSB0aGUgYXBwLlxuXHRyZXR1cm4ge1xuXHRcdHNjcmFwZTogZnVuY3Rpb24oIGZpZWxkcyApIHtcblx0XHRcdGlmICggY29uZmlnLmRlYnVnICkge1xuXHRcdFx0XHRjb25zb2xlLndhcm4oIFwiTm8gU2NyYXBlciBmb3IgZmllbGQgdHlwZTogXCIgKyB0eXBlICk7XG5cdFx0XHR9XG5cdFx0XHRyZXR1cm4gZmllbGRzO1xuXHRcdH0sXG5cdH07XG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IHtcblx0c2V0U2NyYXBlcjogc2V0U2NyYXBlcixcblx0Z2V0U2NyYXBlcjogZ2V0U2NyYXBlcixcbn07XG4iLCIvKiBnbG9iYWwgXyAqL1xuXG52YXIgU2NyYXBlciA9IGZ1bmN0aW9uKCkge307XG5cblNjcmFwZXIucHJvdG90eXBlLnNjcmFwZSA9IGZ1bmN0aW9uKCBmaWVsZHMgKSB7XG5cdGZpZWxkcyA9IF8ubWFwKCBmaWVsZHMsIGZ1bmN0aW9uKCBmaWVsZCApIHtcblx0XHRpZiAoIGZpZWxkLnR5cGUgIT09IFwiYmxvY2tfcHJldmlld1wiICkge1xuXHRcdFx0cmV0dXJuIGZpZWxkO1xuXHRcdH1cblxuXHRcdGZpZWxkLmNvbnRlbnQgPSBmaWVsZC4kZWwuaHRtbCgpO1xuXG5cdFx0cmV0dXJuIGZpZWxkO1xuXHR9ICk7XG5cblx0cmV0dXJuIGZpZWxkcztcbn07XG5cbm1vZHVsZS5leHBvcnRzID0gU2NyYXBlcjtcbiIsIi8qIGdsb2JhbCBfICovXG5cbnZhciBTY3JhcGVyID0gZnVuY3Rpb24oKSB7fTtcblxuU2NyYXBlci5wcm90b3R5cGUuc2NyYXBlID0gZnVuY3Rpb24oIGZpZWxkcyApIHtcblx0ZmllbGRzID0gXy5tYXAoIGZpZWxkcywgZnVuY3Rpb24oIGZpZWxkICkge1xuXHRcdGlmICggZmllbGQudHlwZSAhPT0gXCJlbWFpbFwiICkge1xuXHRcdFx0cmV0dXJuIGZpZWxkO1xuXHRcdH1cblxuXHRcdGZpZWxkLmNvbnRlbnQgPSBmaWVsZC4kZWwuZmluZCggXCJpbnB1dFt0eXBlPWVtYWlsXVtpZF49YWNmXVwiICkudmFsKCk7XG5cblx0XHRyZXR1cm4gZmllbGQ7XG5cdH0gKTtcblxuXHRyZXR1cm4gZmllbGRzO1xufTtcblxubW9kdWxlLmV4cG9ydHMgPSBTY3JhcGVyO1xuIiwiLyogZ2xvYmFsIF8sIGpRdWVyeSAqL1xuXG52YXIgYXR0YWNobWVudENhY2hlID0gcmVxdWlyZSggXCIuLy4uL2NhY2hlL2NhY2hlLmF0dGFjaG1lbnRzLmpzXCIgKTtcblxudmFyIFNjcmFwZXIgPSBmdW5jdGlvbigpIHt9O1xuXG5TY3JhcGVyLnByb3RvdHlwZS5zY3JhcGUgPSBmdW5jdGlvbiggZmllbGRzICkge1xuXHR2YXIgYXR0YWNobWVudF9pZHMgPSBbXTtcblxuXHRmaWVsZHMgPSBfLm1hcCggZmllbGRzLCBmdW5jdGlvbiggZmllbGQgKSB7XG5cdFx0aWYgKCBmaWVsZC50eXBlICE9PSBcImdhbGxlcnlcIiApIHtcblx0XHRcdHJldHVybiBmaWVsZDtcblx0XHR9XG5cblx0XHRmaWVsZC5jb250ZW50ID0gXCJcIjtcblxuXHRcdGZpZWxkLiRlbC5maW5kKCBcIi5hY2YtZ2FsbGVyeS1hdHRhY2htZW50IGlucHV0W3R5cGU9aGlkZGVuXVwiICkuZWFjaCggZnVuY3Rpb24oKSB7XG5cdFx0XHQvLyBUT0RPOiBJcyB0aGlzIHRoZSBiZXN0IHdheSB0byBnZXQgdGhlIGF0dGFjaG1lbnQgaWQ/XG5cdFx0XHR2YXIgYXR0YWNobWVudF9pZCA9IGpRdWVyeSggdGhpcyApLnZhbCgpO1xuXG5cdFx0XHQvLyBDb2xsZWN0IGFsbCBhdHRhY2htZW50IGlkcyBmb3IgY2FjaGUgcmVmcmVzaFxuXHRcdFx0YXR0YWNobWVudF9pZHMucHVzaCggYXR0YWNobWVudF9pZCApO1xuXG5cdFx0XHQvLyBJZiB3ZSBoYXZlIHRoZSBhdHRhY2htZW50IGRhdGEgaW4gdGhlIGNhY2hlIHdlIGNhbiByZXR1cm4gYSB1c2VmdWwgdmFsdWVcblx0XHRcdGlmICggYXR0YWNobWVudENhY2hlLmdldCggYXR0YWNobWVudF9pZCwgXCJhdHRhY2htZW50XCIgKSApIHtcblx0XHRcdFx0dmFyIGF0dGFjaG1lbnQgPSBhdHRhY2htZW50Q2FjaGUuZ2V0KCBhdHRhY2htZW50X2lkLCBcImF0dGFjaG1lbnRcIiApO1xuXG5cdFx0XHRcdGZpZWxkLmNvbnRlbnQgKz0gJzxpbWcgc3JjPVwiJyArIGF0dGFjaG1lbnQudXJsICsgJ1wiIGFsdD1cIicgKyBhdHRhY2htZW50LmFsdCArICdcIiB0aXRsZT1cIicgKyBhdHRhY2htZW50LnRpdGxlICsgJ1wiPic7XG5cdFx0XHR9XG5cdFx0fSApO1xuXG5cdFx0cmV0dXJuIGZpZWxkO1xuXHR9ICk7XG5cblx0YXR0YWNobWVudENhY2hlLnJlZnJlc2goIGF0dGFjaG1lbnRfaWRzICk7XG5cblx0cmV0dXJuIGZpZWxkcztcbn07XG5cbm1vZHVsZS5leHBvcnRzID0gU2NyYXBlcjtcbiIsIi8qIGdsb2JhbCBfICovXG5cbnZhciBhdHRhY2htZW50Q2FjaGUgPSByZXF1aXJlKCBcIi4vLi4vY2FjaGUvY2FjaGUuYXR0YWNobWVudHMuanNcIiApO1xuXG52YXIgU2NyYXBlciA9IGZ1bmN0aW9uKCkge307XG5cblNjcmFwZXIucHJvdG90eXBlLnNjcmFwZSA9IGZ1bmN0aW9uKCBmaWVsZHMgKSB7XG5cdHZhciBhdHRhY2htZW50X2lkcyA9IFtdO1xuXG5cdGZpZWxkcyA9IF8ubWFwKCBmaWVsZHMsIGZ1bmN0aW9uKCBmaWVsZCApIHtcblx0XHRpZiAoIGZpZWxkLnR5cGUgIT09IFwiaW1hZ2VcIiApIHtcblx0XHRcdHJldHVybiBmaWVsZDtcblx0XHR9XG5cblx0XHRmaWVsZC5jb250ZW50ID0gXCJcIjtcblxuXHRcdHZhciBhdHRhY2htZW50X2lkID0gZmllbGQuJGVsLmZpbmQoIFwiaW5wdXRbdHlwZT1oaWRkZW5dXCIgKS52YWwoKTtcblxuXHRcdGF0dGFjaG1lbnRfaWRzLnB1c2goIGF0dGFjaG1lbnRfaWQgKTtcblxuXHRcdGlmICggYXR0YWNobWVudENhY2hlLmdldCggYXR0YWNobWVudF9pZCwgXCJhdHRhY2htZW50XCIgKSApIHtcblx0XHRcdHZhciBhdHRhY2htZW50ID0gYXR0YWNobWVudENhY2hlLmdldCggYXR0YWNobWVudF9pZCwgXCJhdHRhY2htZW50XCIgKTtcblxuXHRcdFx0ZmllbGQuY29udGVudCArPSAnPGltZyBzcmM9XCInICsgYXR0YWNobWVudC51cmwgKyAnXCIgYWx0PVwiJyArIGF0dGFjaG1lbnQuYWx0ICsgJ1wiIHRpdGxlPVwiJyArIGF0dGFjaG1lbnQudGl0bGUgKyAnXCI+Jztcblx0XHR9XG5cblxuXHRcdHJldHVybiBmaWVsZDtcblx0fSApO1xuXG5cdGF0dGFjaG1lbnRDYWNoZS5yZWZyZXNoKCBhdHRhY2htZW50X2lkcyApO1xuXG5cdHJldHVybiBmaWVsZHM7XG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IFNjcmFwZXI7XG4iLCIvKiBnbG9iYWwgXyAqL1xucmVxdWlyZSggXCIuLy4uL3NjcmFwZXItc3RvcmUuanNcIiApO1xuXG52YXIgU2NyYXBlciA9IGZ1bmN0aW9uKCkge307XG5cbi8qKlxuICogU2NyYXBlciBmb3IgdGhlIGxpbmsgZmllbGQgdHlwZS5cbiAqXG4gKiBAcGFyYW0ge09iamVjdH0gZmllbGRzIEZpZWxkcyB0byBwYXJzZS5cbiAqXG4gKiBAcmV0dXJucyB7T2JqZWN0fSBNYXBwZWQgbGlzdCBvZiBmaWVsZHMuXG4gKi9cblNjcmFwZXIucHJvdG90eXBlLnNjcmFwZSA9IGZ1bmN0aW9uKCBmaWVsZHMgKSB7XG5cdC8qKlxuXHQgKiBTZXQgY29udGVudCBmb3IgYWxsIGxpbmsgZmllbGRzIGFzIGEtdGFnIHdpdGggdGl0bGUsIHVybCBhbmQgdGFyZ2V0LlxuXHQgKiBSZXR1cm4gdGhlIGZpZWxkcyBvYmplY3QgY29udGFpbmluZyBhbGwgZmllbGRzLlxuXHQgKi9cblx0cmV0dXJuIF8ubWFwKCBmaWVsZHMsIGZ1bmN0aW9uKCBmaWVsZCApIHtcblx0XHRpZiAoIGZpZWxkLnR5cGUgIT09IFwibGlua1wiICkge1xuXHRcdFx0cmV0dXJuIGZpZWxkO1xuXHRcdH1cblxuXHRcdHZhciB0aXRsZSA9IGZpZWxkLiRlbC5maW5kKCBcImlucHV0W3R5cGU9aGlkZGVuXS5pbnB1dC10aXRsZVwiICkudmFsKCksXG5cdFx0XHR1cmwgPSBmaWVsZC4kZWwuZmluZCggXCJpbnB1dFt0eXBlPWhpZGRlbl0uaW5wdXQtdXJsXCIgKS52YWwoKSxcblx0XHRcdHRhcmdldCA9IGZpZWxkLiRlbC5maW5kKCBcImlucHV0W3R5cGU9aGlkZGVuXS5pbnB1dC10YXJnZXRcIiApLnZhbCgpO1xuXG5cdFx0ZmllbGQuY29udGVudCA9IFwiPGEgaHJlZj1cXFwiXCIgKyB1cmwgKyBcIlxcXCIgdGFyZ2V0PVxcXCJcIiArIHRhcmdldCArIFwiXFxcIj5cIiArIHRpdGxlICsgXCI8L2E+XCI7XG5cblx0XHRyZXR1cm4gZmllbGQ7XG5cdH0gKTtcbn07XG5cbm1vZHVsZS5leHBvcnRzID0gU2NyYXBlcjtcbiIsIi8qIGdsb2JhbCBfLCBhY2YgKi9cblxudmFyIFNjcmFwZXIgPSBmdW5jdGlvbigpIHt9O1xuXG5TY3JhcGVyLnByb3RvdHlwZS5zY3JhcGUgPSBmdW5jdGlvbiggZmllbGRzICkge1xuXHRmaWVsZHMgPSBfLm1hcCggZmllbGRzLCBmdW5jdGlvbiggZmllbGQgKSB7XG5cdFx0aWYgKCBmaWVsZC50eXBlICE9PSBcInRheG9ub215XCIgKSB7XG5cdFx0XHRyZXR1cm4gZmllbGQ7XG5cdFx0fVxuXG5cdFx0dmFyIHRlcm1zID0gW107XG5cblx0XHRpZiAoIGZpZWxkLiRlbC5maW5kKCAnLmFjZi10YXhvbm9teS1maWVsZFtkYXRhLXR5cGU9XCJtdWx0aV9zZWxlY3RcIl0nICkubGVuZ3RoID4gMCApIHtcblx0XHRcdHZhciBzZWxlY3QyVGFyZ2V0ID0gKCBhY2Yuc2VsZWN0Mi52ZXJzaW9uID49IDQgKSA/IFwic2VsZWN0XCIgOiBcImlucHV0XCI7XG5cblx0XHRcdHRlcm1zID0gXy5wbHVjayhcblx0XHRcdFx0ZmllbGQuJGVsLmZpbmQoICcuYWNmLXRheG9ub215LWZpZWxkW2RhdGEtdHlwZT1cIm11bHRpX3NlbGVjdFwiXSAnICsgc2VsZWN0MlRhcmdldCApXG5cdFx0XHRcdFx0LnNlbGVjdDIoIFwiZGF0YVwiIClcblx0XHRcdFx0LCBcInRleHRcIlxuXHRcdFx0KTtcblx0XHR9IGVsc2UgaWYgKCBmaWVsZC4kZWwuZmluZCggJy5hY2YtdGF4b25vbXktZmllbGRbZGF0YS10eXBlPVwiY2hlY2tib3hcIl0nICkubGVuZ3RoID4gMCApIHtcblx0XHRcdHRlcm1zID0gXy5wbHVjayhcblx0XHRcdFx0ZmllbGQuJGVsLmZpbmQoICcuYWNmLXRheG9ub215LWZpZWxkW2RhdGEtdHlwZT1cImNoZWNrYm94XCJdIGlucHV0W3R5cGU9XCJjaGVja2JveFwiXTpjaGVja2VkJyApXG5cdFx0XHRcdFx0Lm5leHQoKSxcblx0XHRcdFx0XCJ0ZXh0Q29udGVudFwiXG5cdFx0XHQpO1xuXHRcdH0gZWxzZSBpZiAoIGZpZWxkLiRlbC5maW5kKCBcImlucHV0W3R5cGU9Y2hlY2tib3hdOmNoZWNrZWRcIiApLmxlbmd0aCA+IDAgKSB7XG5cdFx0XHR0ZXJtcyA9IF8ucGx1Y2soXG5cdFx0XHRcdGZpZWxkLiRlbC5maW5kKCBcImlucHV0W3R5cGU9Y2hlY2tib3hdOmNoZWNrZWRcIiApXG5cdFx0XHRcdFx0LnBhcmVudCgpLFxuXHRcdFx0XHRcInRleHRDb250ZW50XCJcblx0XHRcdCk7XG5cdFx0fSBlbHNlIGlmICggZmllbGQuJGVsLmZpbmQoIFwic2VsZWN0IG9wdGlvbjpjaGVja2VkXCIgKS5sZW5ndGggPiAwICkge1xuXHRcdFx0dGVybXMgPSBfLnBsdWNrKFxuXHRcdFx0XHRmaWVsZC4kZWwuZmluZCggXCJzZWxlY3Qgb3B0aW9uOmNoZWNrZWRcIiApLFxuXHRcdFx0XHRcInRleHRDb250ZW50XCJcblx0XHRcdCk7XG5cdFx0fVxuXG5cdFx0dGVybXMgPSBfLm1hcCggdGVybXMsIGZ1bmN0aW9uKCB0ZXJtICkge1xuXHRcdFx0cmV0dXJuIHRlcm0udHJpbSgpO1xuXHRcdH0gKTtcblxuXHRcdGlmICggdGVybXMubGVuZ3RoID4gMCApIHtcblx0XHRcdGZpZWxkLmNvbnRlbnQgPSBcIjx1bD5cXG48bGk+XCIgKyB0ZXJtcy5qb2luKCBcIjwvbGk+XFxuPGxpPlwiICkgKyBcIjwvbGk+XFxuPC91bD5cIjtcblx0XHR9XG5cblx0XHRyZXR1cm4gZmllbGQ7XG5cdH0gKTtcblxuXHRyZXR1cm4gZmllbGRzO1xufTtcblxubW9kdWxlLmV4cG9ydHMgPSBTY3JhcGVyO1xuIiwiLyogZ2xvYmFsIF8gKi9cblxudmFyIGNvbmZpZyA9IHJlcXVpcmUoIFwiLi8uLi9jb25maWcvY29uZmlnLmpzXCIgKTtcblxudmFyIFNjcmFwZXIgPSBmdW5jdGlvbigpIHt9O1xuXG5TY3JhcGVyLnByb3RvdHlwZS5zY3JhcGUgPSBmdW5jdGlvbiggZmllbGRzICkge1xuXHR2YXIgdGhhdCA9IHRoaXM7XG5cblx0ZmllbGRzID0gXy5tYXAoIGZpZWxkcywgZnVuY3Rpb24oIGZpZWxkICkge1xuXHRcdGlmICggZmllbGQudHlwZSAhPT0gXCJ0ZXh0XCIgKSB7XG5cdFx0XHRyZXR1cm4gZmllbGQ7XG5cdFx0fVxuXG5cdFx0ZmllbGQuY29udGVudCA9IGZpZWxkLiRlbC5maW5kKCBcImlucHV0W3R5cGU9dGV4dF1baWRePWFjZl1cIiApLnZhbCgpO1xuXHRcdGZpZWxkID0gdGhhdC53cmFwSW5IZWFkbGluZSggZmllbGQgKTtcblxuXHRcdHJldHVybiBmaWVsZDtcblx0fSApO1xuXG5cdHJldHVybiBmaWVsZHM7XG59O1xuXG5TY3JhcGVyLnByb3RvdHlwZS53cmFwSW5IZWFkbGluZSA9IGZ1bmN0aW9uKCBmaWVsZCApIHtcblx0dmFyIGxldmVsID0gdGhpcy5pc0hlYWRsaW5lKCBmaWVsZCApO1xuXHRpZiAoIGxldmVsICkge1xuXHRcdGZpZWxkLmNvbnRlbnQgPSBcIjxoXCIgKyBsZXZlbCArIFwiPlwiICsgZmllbGQuY29udGVudCArIFwiPC9oXCIgKyBsZXZlbCArIFwiPlwiO1xuXHR9IGVsc2Uge1xuXHRcdGZpZWxkLmNvbnRlbnQgPSBcIjxwPlwiICsgZmllbGQuY29udGVudCArIFwiPC9wPlwiO1xuXHR9XG5cblx0cmV0dXJuIGZpZWxkO1xufTtcblxuU2NyYXBlci5wcm90b3R5cGUuaXNIZWFkbGluZSA9IGZ1bmN0aW9uKCBmaWVsZCApIHtcblx0dmFyIGxldmVsID0gXy5maW5kKCBjb25maWcuc2NyYXBlci50ZXh0LmhlYWRsaW5lcywgZnVuY3Rpb24oIHZhbHVlLCBrZXkgKSB7XG5cdFx0cmV0dXJuIGZpZWxkLmtleSA9PT0ga2V5O1xuXHR9ICk7XG5cblx0Ly8gSXQgaGFzIHRvIGJlIGFuIGludGVnZXJcblx0aWYgKCBsZXZlbCApIHtcblx0XHRsZXZlbCA9IHBhcnNlSW50KCBsZXZlbCwgMTAgKTtcblx0fVxuXG5cdC8vIEhlYWRsaW5lcyBvbmx5IGV4aXN0IGZyb20gaDEgdG8gaDZcblx0aWYgKCBsZXZlbCA8IDEgfHwgbGV2ZWwgPiA2ICkge1xuXHRcdGxldmVsID0gZmFsc2U7XG5cdH1cblxuXHRyZXR1cm4gbGV2ZWw7XG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IFNjcmFwZXI7XG4iLCIvKiBnbG9iYWwgXyAqL1xuXG52YXIgU2NyYXBlciA9IGZ1bmN0aW9uKCkge307XG5cblNjcmFwZXIucHJvdG90eXBlLnNjcmFwZSA9IGZ1bmN0aW9uKCBmaWVsZHMgKSB7XG5cdGZpZWxkcyA9IF8ubWFwKCBmaWVsZHMsIGZ1bmN0aW9uKCBmaWVsZCApIHtcblx0XHRpZiAoIGZpZWxkLnR5cGUgIT09IFwidGV4dGFyZWFcIiApIHtcblx0XHRcdHJldHVybiBmaWVsZDtcblx0XHR9XG5cblx0XHRmaWVsZC5jb250ZW50ID0gXCI8cD5cIiArIGZpZWxkLiRlbC5maW5kKCBcInRleHRhcmVhW2lkXj1hY2ZdXCIgKS52YWwoKSArIFwiPC9wPlwiO1xuXG5cdFx0cmV0dXJuIGZpZWxkO1xuXHR9ICk7XG5cblx0cmV0dXJuIGZpZWxkcztcbn07XG5cbm1vZHVsZS5leHBvcnRzID0gU2NyYXBlcjtcbiIsIi8qIGdsb2JhbCBfICovXG5cbnZhciBTY3JhcGVyID0gZnVuY3Rpb24oKSB7fTtcblxuU2NyYXBlci5wcm90b3R5cGUuc2NyYXBlID0gZnVuY3Rpb24oIGZpZWxkcyApIHtcblx0ZmllbGRzID0gXy5tYXAoIGZpZWxkcywgZnVuY3Rpb24oIGZpZWxkICkge1xuXHRcdGlmICggZmllbGQudHlwZSAhPT0gXCJ1cmxcIiApIHtcblx0XHRcdHJldHVybiBmaWVsZDtcblx0XHR9XG5cblx0XHR2YXIgY29udGVudCA9IGZpZWxkLiRlbC5maW5kKCBcImlucHV0W3R5cGU9dXJsXVtpZF49YWNmXVwiICkudmFsKCk7XG5cblx0XHRmaWVsZC5jb250ZW50ID0gY29udGVudCA/ICc8YSBocmVmPVwiJyArIGNvbnRlbnQgKyAnXCI+JyArIGNvbnRlbnQgKyBcIjwvYT5cIiA6IFwiXCI7XG5cblx0XHRyZXR1cm4gZmllbGQ7XG5cdH0gKTtcblxuXHRyZXR1cm4gZmllbGRzO1xufTtcblxubW9kdWxlLmV4cG9ydHMgPSBTY3JhcGVyO1xuIiwiLyogZ2xvYmFsIHRpbnlNQ0UsIF8gKi9cblxudmFyIFNjcmFwZXIgPSBmdW5jdGlvbigpIHt9O1xuXG4vKipcbiAqIEFkYXB0ZWQgZnJvbSB3cC1zZW8tcG9zdC1zY3JhcGVyLXBsdWdpbi0zMTAuanM6MTk2LTIxMFxuICpcbiAqIEBwYXJhbSB7c3RyaW5nfSBlZGl0b3JJRCBUaW55TUNFIGlkZW50aWZpZXIgdG8gbG9vayB1cC5cbiAqXG4gKiBAcmV0dXJucyB7Ym9vbGVhbn0gVHJ1ZSBpZiBhbiBlZGl0b3IgZXhpc3RzIGZvciB0aGUgc3VwcGxpZWQgSUQuXG4gKi9cbnZhciBpc1RpbnlNQ0VBdmFpbGFibGUgPSBmdW5jdGlvbiggZWRpdG9ySUQgKSB7XG5cdGlmICggdHlwZW9mIHRpbnlNQ0UgPT09IFwidW5kZWZpbmVkXCIgfHxcblx0XHQgdHlwZW9mIHRpbnlNQ0UuZWRpdG9ycyA9PT0gXCJ1bmRlZmluZWRcIiB8fFxuXHRcdCB0aW55TUNFLmVkaXRvcnMubGVuZ3RoID09PSAwIHx8XG5cdFx0IHRpbnlNQ0UuZ2V0KCBlZGl0b3JJRCApID09PSBudWxsIHx8XG5cdFx0IHRpbnlNQ0UuZ2V0KCBlZGl0b3JJRCApLmlzSGlkZGVuKCkgKSB7XG5cdFx0cmV0dXJuIGZhbHNlO1xuXHR9XG5cblx0cmV0dXJuIHRydWU7XG59O1xuXG4vKipcbiAqIEFkYXB0ZWQgZnJvbSB3cC1zZW8tc2hvcnRjb2RlLXBsdWdpbi0zMDUuanM6MTE1LTEyNlxuICpcbiAqIEBwYXJhbSB7T2JqZWN0fSBmaWVsZCBGaWVsZCB0byBnZXQgdGhlIGNvbnRlbnQgZm9yLlxuICpcbiAqIEByZXR1cm5zIHtzdHJpbmd9IFRoZSBjb250ZW50IG9mIHRoZSBmaWVsZC5cbiAqL1xudmFyIGdldENvbnRlbnRUaW55TUNFID0gZnVuY3Rpb24oIGZpZWxkICkge1xuXHR2YXIgdGV4dGFyZWEgPSBmaWVsZC4kZWwuZmluZCggXCJ0ZXh0YXJlYVwiIClbIDAgXTtcblx0dmFyIGVkaXRvcklEID0gdGV4dGFyZWEuaWQ7XG5cdHZhciB2YWwgPSB0ZXh0YXJlYS52YWx1ZTtcblxuXHRpZiAoIGlzVGlueU1DRUF2YWlsYWJsZSggZWRpdG9ySUQgKSApIHtcblx0XHR2YWwgPSB0aW55TUNFLmdldCggZWRpdG9ySUQgKSAmJiB0aW55TUNFLmdldCggZWRpdG9ySUQgKS5nZXRDb250ZW50KCkgfHwgXCJcIjtcblx0fVxuXG5cdHJldHVybiB2YWw7XG59O1xuXG5TY3JhcGVyLnByb3RvdHlwZS5zY3JhcGUgPSBmdW5jdGlvbiggZmllbGRzICkge1xuXHRmaWVsZHMgPSBfLm1hcCggZmllbGRzLCBmdW5jdGlvbiggZmllbGQgKSB7XG5cdFx0aWYgKCBmaWVsZC50eXBlICE9PSBcInd5c2l3eWdcIiApIHtcblx0XHRcdHJldHVybiBmaWVsZDtcblx0XHR9XG5cblx0XHRmaWVsZC5jb250ZW50ID0gZ2V0Q29udGVudFRpbnlNQ0UoIGZpZWxkICk7XG5cblx0XHRyZXR1cm4gZmllbGQ7XG5cdH0gKTtcblxuXHRyZXR1cm4gZmllbGRzO1xufTtcblxubW9kdWxlLmV4cG9ydHMgPSBTY3JhcGVyO1xuIl19
