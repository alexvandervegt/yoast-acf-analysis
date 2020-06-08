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

	// Return only fields in metabox areas (either below or side) or
	// ACF block fields in the content (not in the sidebar, to prevent duplicates)
	var parentContainer = jQuery( ".metabox-location-normal, .metabox-location-side, .acf-block-component.acf-block-body" );
	var fields = _.map( acf.get_fields( false, parentContainer ), function( field ) {
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
				return block.name.startsWith( "acf/" ) && block.attributes.mode === "preview";
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
	} else {
		// Gutenberg is not available. Use the old method.
		var index = 0;
		fields = _.union( fields, _.map( jQuery( ".acf-block-preview" ), function( field ) {
			var fieldData = {
				$el: jQuery( field ),
				key: null,
				type: "block_preview",
				name: "block_preview_" + index,
				post_meta_key: "block_preview_" + index,
			};
			innerFields.push( fieldData );
			index++;
			return fieldData;
		} ) );
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
/* global jQuery, YoastSEO, YoastACFAnalysis: true */
/* exported YoastACFAnalysis */

var App = require( "./app.js" );

( function( $ ) {
	$( document ).ready( function() {
		if ( "undefined" !== typeof YoastSEO ) {
			YoastACFAnalysis = new App();
		}
	} );
}( jQuery ) );

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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJqcy9zcmMvYXBwLmpzIiwianMvc3JjL2NhY2hlL2NhY2hlLmF0dGFjaG1lbnRzLmpzIiwianMvc3JjL2NhY2hlL2NhY2hlLmpzIiwianMvc3JjL2NvbGxlY3QvY29sbGVjdC12NC5qcyIsImpzL3NyYy9jb2xsZWN0L2NvbGxlY3QtdjUuanMiLCJqcy9zcmMvY29sbGVjdC9jb2xsZWN0LmpzIiwianMvc3JjL2NvbmZpZy9jb25maWcuanMiLCJqcy9zcmMvaGVscGVyLmpzIiwianMvc3JjL21haW4uanMiLCJqcy9zcmMvcmVwbGFjZXZhcnMuanMiLCJqcy9zcmMvc2NyYXBlci1zdG9yZS5qcyIsImpzL3NyYy9zY3JhcGVyL3NjcmFwZXIuYmxvY2tfcHJldmlldy5qcyIsImpzL3NyYy9zY3JhcGVyL3NjcmFwZXIuZW1haWwuanMiLCJqcy9zcmMvc2NyYXBlci9zY3JhcGVyLmdhbGxlcnkuanMiLCJqcy9zcmMvc2NyYXBlci9zY3JhcGVyLmltYWdlLmpzIiwianMvc3JjL3NjcmFwZXIvc2NyYXBlci5saW5rLmpzIiwianMvc3JjL3NjcmFwZXIvc2NyYXBlci50YXhvbm9teS5qcyIsImpzL3NyYy9zY3JhcGVyL3NjcmFwZXIudGV4dC5qcyIsImpzL3NyYy9zY3JhcGVyL3NjcmFwZXIudGV4dGFyZWEuanMiLCJqcy9zcmMvc2NyYXBlci9zY3JhcGVyLnVybC5qcyIsImpzL3NyYy9zY3JhcGVyL3NjcmFwZXIud3lzaXd5Zy5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQTtBQ0FBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3ZGQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzlDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3BEQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3RCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDL0ZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMvRkE7QUFDQTtBQUNBOztBQ0ZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNMQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNaQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3ZEQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNoR0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNuQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNuQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN4Q0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDcENBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2pDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN0REE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3JEQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ25CQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNyQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EiLCJmaWxlIjoiZ2VuZXJhdGVkLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXNDb250ZW50IjpbIihmdW5jdGlvbigpe2Z1bmN0aW9uIHIoZSxuLHQpe2Z1bmN0aW9uIG8oaSxmKXtpZighbltpXSl7aWYoIWVbaV0pe3ZhciBjPVwiZnVuY3Rpb25cIj09dHlwZW9mIHJlcXVpcmUmJnJlcXVpcmU7aWYoIWYmJmMpcmV0dXJuIGMoaSwhMCk7aWYodSlyZXR1cm4gdShpLCEwKTt2YXIgYT1uZXcgRXJyb3IoXCJDYW5ub3QgZmluZCBtb2R1bGUgJ1wiK2krXCInXCIpO3Rocm93IGEuY29kZT1cIk1PRFVMRV9OT1RfRk9VTkRcIixhfXZhciBwPW5baV09e2V4cG9ydHM6e319O2VbaV1bMF0uY2FsbChwLmV4cG9ydHMsZnVuY3Rpb24ocil7dmFyIG49ZVtpXVsxXVtyXTtyZXR1cm4gbyhufHxyKX0scCxwLmV4cG9ydHMscixlLG4sdCl9cmV0dXJuIG5baV0uZXhwb3J0c31mb3IodmFyIHU9XCJmdW5jdGlvblwiPT10eXBlb2YgcmVxdWlyZSYmcmVxdWlyZSxpPTA7aTx0Lmxlbmd0aDtpKyspbyh0W2ldKTtyZXR1cm4gb31yZXR1cm4gcn0pKCkiLCIvKiBnbG9iYWwgWW9hc3RTRU8sIGFjZiwgXywgalF1ZXJ5LCB3cCAqL1xudmFyIGNvbmZpZyA9IHJlcXVpcmUoIFwiLi9jb25maWcvY29uZmlnLmpzXCIgKTtcbnZhciBoZWxwZXIgPSByZXF1aXJlKCBcIi4vaGVscGVyLmpzXCIgKTtcbnZhciBjb2xsZWN0ID0gcmVxdWlyZSggXCIuL2NvbGxlY3QvY29sbGVjdC5qc1wiICk7XG52YXIgcmVwbGFjZVZhcnMgPSByZXF1aXJlKCBcIi4vcmVwbGFjZXZhcnMuanNcIiApO1xuXG52YXIgYW5hbHlzaXNUaW1lb3V0ID0gMDtcblxudmFyIEFwcCA9IGZ1bmN0aW9uKCkge1xuXHRZb2FzdFNFTy5hcHAucmVnaXN0ZXJQbHVnaW4oIGNvbmZpZy5wbHVnaW5OYW1lLCB7IHN0YXR1czogXCJyZWFkeVwiIH0gKTtcblxuXHRZb2FzdFNFTy5hcHAucmVnaXN0ZXJNb2RpZmljYXRpb24oIFwiY29udGVudFwiLCBjb2xsZWN0LmFwcGVuZC5iaW5kKCBjb2xsZWN0ICksIGNvbmZpZy5wbHVnaW5OYW1lICk7XG5cblx0dGhpcy5iaW5kTGlzdGVuZXJzKCk7XG59O1xuXG4vKipcbiAqIEFDRiA0IExpc3RlbmVyLlxuICpcbiAqIEBwYXJhbSB7QXJyYXl9IGZpZWxkU2VsZWN0b3JzIExpc3Qgb2YgZmllbGQgc2VsZWN0b3JzLlxuICogQHBhcmFtIHtzdHJpbmd9IHd5c2l3eWdTZWxlY3RvciBFbGVtZW50IHNlbGVjdG9yIGZvciBXWVNJV1lHIGZpZWxkcy5cbiAqIEBwYXJhbSB7QXJyYXl9IGZpZWxkU2VsZWN0b3JzV2l0aG91dFd5c2l3eWcgTGlzdCBvZiBmaWVsZHMuXG4gKlxuICogQHJldHVybnMge3ZvaWR9XG4gKi9cbkFwcC5wcm90b3R5cGUuYWNmNExpc3RlbmVyID0gZnVuY3Rpb24oIGZpZWxkU2VsZWN0b3JzLCB3eXNpd3lnU2VsZWN0b3IsIGZpZWxkU2VsZWN0b3JzV2l0aG91dFd5c2l3eWcgKSB7XG5cdHJlcGxhY2VWYXJzLnVwZGF0ZVJlcGxhY2VWYXJzKCBjb2xsZWN0ICk7XG5cblx0dmFyIGZpZWxkc1dpdGhvdXRXeXNpd3lnID0galF1ZXJ5KCBcIiNwb3N0LWJvZHksICNlZGl0dGFnXCIgKS5maW5kKCBmaWVsZFNlbGVjdG9yc1dpdGhvdXRXeXNpd3lnLmpvaW4oIFwiLFwiICkgKTtcblx0dmFyIGZpZWxkcyA9IGpRdWVyeSggXCIjcG9zdC1ib2R5LCAjZWRpdHRhZ1wiICkuZmluZCggZmllbGRTZWxlY3RvcnMuam9pbiggXCIsXCIgKSApO1xuXG5cdGZpZWxkc1dpdGhvdXRXeXNpd3lnLm9uKCBcImNoYW5nZVwiLCB0aGlzLm1heWJlUmVmcmVzaC5iaW5kKCB0aGlzICkgKTtcblx0Ly8gRG8gbm90IGlnbm9yZSBXeXNpd3lnIGZpZWxkcyBmb3IgdGhlIHB1cnBvc2Ugb2YgUmVwbGFjZSBWYXJzLlxuXHRmaWVsZHMub24oIFwiY2hhbmdlXCIsIHJlcGxhY2VWYXJzLnVwZGF0ZVJlcGxhY2VWYXJzLmJpbmQoIHRoaXMsIGNvbGxlY3QgKSApO1xuXG5cdGlmICggWW9hc3RTRU8ud3AuX3RpbnlNQ0VIZWxwZXIgKSB7XG5cdFx0alF1ZXJ5KCB3eXNpd3lnU2VsZWN0b3IgKS5lYWNoKCBmdW5jdGlvbigpIHtcblx0XHRcdFlvYXN0U0VPLndwLl90aW55TUNFSGVscGVyLmFkZEV2ZW50SGFuZGxlciggdGhpcy5pZCwgWyBcImlucHV0XCIsIFwiY2hhbmdlXCIsIFwiY3V0XCIsIFwicGFzdGVcIiBdLFxuXHRcdFx0XHRyZXBsYWNlVmFycy51cGRhdGVSZXBsYWNlVmFycy5iaW5kKCB0aGlzLCBjb2xsZWN0ICkgKTtcblx0XHR9ICk7XG5cdH1cblxuXHQvLyBBbHNvIHJlZnJlc2ggb24gbWVkaWEgY2xvc2UgYXMgYXR0YWNobWVudCBkYXRhIG1pZ2h0IGhhdmUgY2hhbmdlZFxuXHR3cC5tZWRpYS5mcmFtZS5vbiggXCJjbG9zZVwiLCB0aGlzLm1heWJlUmVmcmVzaCApO1xufTtcblxuLyoqXG4gKiBBQ0YgNSBMaXN0ZW5lci5cbiAqXG4gKiBAcmV0dXJucyB7dm9pZH1cbiAqL1xuQXBwLnByb3RvdHlwZS5hY2Y1TGlzdGVuZXIgPSBmdW5jdGlvbigpIHtcblx0cmVwbGFjZVZhcnMudXBkYXRlUmVwbGFjZVZhcnMoIGNvbGxlY3QgKTtcblxuXHRhY2YuYWRkX2FjdGlvbiggXCJjaGFuZ2UgcmVtb3ZlIGFwcGVuZCBzb3J0c3RvcFwiLCB0aGlzLm1heWJlUmVmcmVzaCApO1xuXHRhY2YuYWRkX2FjdGlvbiggXCJjaGFuZ2UgcmVtb3ZlIGFwcGVuZCBzb3J0c3RvcFwiLCByZXBsYWNlVmFycy51cGRhdGVSZXBsYWNlVmFycy5iaW5kKCB0aGlzLCBjb2xsZWN0ICkgKTtcbn07XG5cbkFwcC5wcm90b3R5cGUuYmluZExpc3RlbmVycyA9IGZ1bmN0aW9uKCkge1xuXHRpZiAoIGhlbHBlci5hY2ZfdmVyc2lvbiA+PSA1ICkge1xuXHRcdGpRdWVyeSggdGhpcy5hY2Y1TGlzdGVuZXIuYmluZCggdGhpcyApICk7XG5cdH0gZWxzZSB7XG5cdFx0dmFyIGZpZWxkU2VsZWN0b3JzID0gY29uZmlnLmZpZWxkU2VsZWN0b3JzLnNsaWNlKCAwICk7XG5cdFx0dmFyIHd5c2l3eWdTZWxlY3RvciA9IFwidGV4dGFyZWFbaWRePXd5c2l3eWctYWNmXVwiO1xuXG5cdFx0Ly8gSWdub3JlIFd5c2l3eWcgZmllbGRzIGJlY2F1c2UgdGhleSB0cmlnZ2VyIGEgcmVmcmVzaCBpbiBZb2FzdCBTRU8gaXRzZWxmXG5cdFx0dmFyIGZpZWxkU2VsZWN0b3JzV2l0aG91dFd5c2l3eWcgPSBfLndpdGhvdXQoIGZpZWxkU2VsZWN0b3JzLCB3eXNpd3lnU2VsZWN0b3IgKTtcblxuXHRcdGpRdWVyeSggZG9jdW1lbnQgKS5vbiggXCJhY2Yvc2V0dXBfZmllbGRzXCIsIHRoaXMuYWNmNExpc3RlbmVyLmJpbmQoIHRoaXMsIGZpZWxkU2VsZWN0b3JzLCB3eXNpd3lnU2VsZWN0b3IsIGZpZWxkU2VsZWN0b3JzV2l0aG91dFd5c2l3eWcgKSApO1xuXHR9XG59O1xuXG5BcHAucHJvdG90eXBlLm1heWJlUmVmcmVzaCA9IGZ1bmN0aW9uKCkge1xuXHRpZiAoIGFuYWx5c2lzVGltZW91dCApIHtcblx0XHR3aW5kb3cuY2xlYXJUaW1lb3V0KCBhbmFseXNpc1RpbWVvdXQgKTtcblx0fVxuXG5cdGFuYWx5c2lzVGltZW91dCA9IHdpbmRvdy5zZXRUaW1lb3V0KCBmdW5jdGlvbigpIHtcblx0XHRpZiAoIGNvbmZpZy5kZWJ1ZyApIHtcblx0XHRcdGNvbnNvbGUubG9nKCBcIlJlY2FsY3VsYXRlLi4uXCIgKyBuZXcgRGF0ZSgpICsgXCIoSW50ZXJuYWwpXCIgKTtcblx0XHR9XG5cblx0XHRZb2FzdFNFTy5hcHAucGx1Z2luUmVsb2FkZWQoIGNvbmZpZy5wbHVnaW5OYW1lICk7XG5cdH0sIGNvbmZpZy5yZWZyZXNoUmF0ZSApO1xufTtcblxubW9kdWxlLmV4cG9ydHMgPSBBcHA7XG4iLCIvKiBnbG9iYWwgXyAqL1xudmFyIGNhY2hlID0gcmVxdWlyZSggXCIuL2NhY2hlLmpzXCIgKTtcblxudmFyIHJlZnJlc2ggPSBmdW5jdGlvbiggYXR0YWNobWVudF9pZHMgKSB7XG5cdHZhciB1bmNhY2hlZCA9IGNhY2hlLmdldFVuY2FjaGVkKCBhdHRhY2htZW50X2lkcywgXCJhdHRhY2htZW50XCIgKTtcblxuXHRpZiAoIHVuY2FjaGVkLmxlbmd0aCA9PT0gMCApIHtcblx0XHRyZXR1cm47XG5cdH1cblxuXHR3aW5kb3cud3AuYWpheC5wb3N0KCBcInF1ZXJ5LWF0dGFjaG1lbnRzXCIsIHtcblx0XHRxdWVyeToge1xuXHRcdFx0cG9zdF9faW46IHVuY2FjaGVkLFxuXHRcdH0sXG5cdH0gKS5kb25lKCBmdW5jdGlvbiggYXR0YWNobWVudHMgKSB7XG5cdFx0Xy5lYWNoKCBhdHRhY2htZW50cywgZnVuY3Rpb24oIGF0dGFjaG1lbnQgKSB7XG5cdFx0XHRjYWNoZS5zZXQoIGF0dGFjaG1lbnQuaWQsIGF0dGFjaG1lbnQsIFwiYXR0YWNobWVudFwiICk7XG5cdFx0XHR3aW5kb3cuWW9hc3RBQ0ZBbmFseXNpcy5tYXliZVJlZnJlc2goKTtcblx0XHR9ICk7XG5cdH0gKTtcbn07XG5cbnZhciBnZXQgPSBmdW5jdGlvbiggaWQgKSB7XG5cdHZhciBhdHRhY2htZW50ID0gY2FjaGUuZ2V0KCBpZCwgXCJhdHRhY2htZW50XCIgKTtcblxuXHRpZiAoICEgYXR0YWNobWVudCApIHtcblx0XHRyZXR1cm4gZmFsc2U7XG5cdH1cblxuXHR2YXIgY2hhbmdlZEF0dGFjaG1lbnQgPSB3aW5kb3cud3AubWVkaWEuYXR0YWNobWVudCggaWQgKTtcblxuXHRpZiAoIGNoYW5nZWRBdHRhY2htZW50LmhhcyggXCJhbHRcIiApICkge1xuXHRcdGF0dGFjaG1lbnQuYWx0ID0gY2hhbmdlZEF0dGFjaG1lbnQuZ2V0KCBcImFsdFwiICk7XG5cdH1cblxuXHRpZiAoIGNoYW5nZWRBdHRhY2htZW50LmhhcyggXCJ0aXRsZVwiICkgKSB7XG5cdFx0YXR0YWNobWVudC50aXRsZSA9IGNoYW5nZWRBdHRhY2htZW50LmdldCggXCJ0aXRsZVwiICk7XG5cdH1cblxuXHRyZXR1cm4gYXR0YWNobWVudDtcbn07XG5cbm1vZHVsZS5leHBvcnRzID0ge1xuXHRyZWZyZXNoOiByZWZyZXNoLFxuXHRnZXQ6IGdldCxcbn07XG4iLCIvKiBnbG9iYWwgXyAqL1xudmFyIENhY2hlID0gZnVuY3Rpb24oKSB7XG5cdHRoaXMuY2xlYXIoIFwiYWxsXCIgKTtcbn07XG5cbnZhciBfY2FjaGU7XG5cbkNhY2hlLnByb3RvdHlwZS5zZXQgPSBmdW5jdGlvbiggaWQsIHZhbHVlLCBzdG9yZSApIHtcblx0c3RvcmUgPSB0eXBlb2Ygc3RvcmUgPT09IFwidW5kZWZpbmVkXCIgPyBcImRlZmF1bHRcIiA6IHN0b3JlO1xuXG5cdGlmICggISAoIHN0b3JlIGluIF9jYWNoZSApICkge1xuXHRcdF9jYWNoZVsgc3RvcmUgXSA9IHt9O1xuXHR9XG5cblx0X2NhY2hlWyBzdG9yZSBdWyBpZCBdID0gdmFsdWU7XG59O1xuXG5DYWNoZS5wcm90b3R5cGUuZ2V0ID0gIGZ1bmN0aW9uKCBpZCwgc3RvcmUgKSB7XG5cdHN0b3JlID0gdHlwZW9mIHN0b3JlID09PSBcInVuZGVmaW5lZFwiID8gXCJkZWZhdWx0XCIgOiBzdG9yZTtcblxuXHRpZiAoIHN0b3JlIGluIF9jYWNoZSAmJiBpZCBpbiBfY2FjaGVbIHN0b3JlIF0gKSB7XG5cdFx0cmV0dXJuIF9jYWNoZVsgc3RvcmUgXVsgaWQgXTtcblx0fVxuXG5cdHJldHVybiBmYWxzZTtcbn07XG5cbkNhY2hlLnByb3RvdHlwZS5nZXRVbmNhY2hlZCA9ICBmdW5jdGlvbiggaWRzLCBzdG9yZSApIHtcblx0c3RvcmUgPSB0eXBlb2Ygc3RvcmUgPT09IFwidW5kZWZpbmVkXCIgPyBcImRlZmF1bHRcIiA6IHN0b3JlO1xuXG5cdHZhciB0aGF0ID0gdGhpcztcblxuXHRpZHMgPSBfLnVuaXEoIGlkcyApO1xuXG5cdHJldHVybiBpZHMuZmlsdGVyKCBmdW5jdGlvbiggaWQgKSB7XG5cdFx0dmFyIHZhbHVlID0gdGhhdC5nZXQoIGlkLCBzdG9yZSApO1xuXG5cdFx0cmV0dXJuIHZhbHVlID09PSBmYWxzZTtcblx0fSApO1xufTtcblxuQ2FjaGUucHJvdG90eXBlLmNsZWFyID0gIGZ1bmN0aW9uKCBzdG9yZSApIHtcblx0c3RvcmUgPSB0eXBlb2Ygc3RvcmUgPT09IFwidW5kZWZpbmVkXCIgPyBcImRlZmF1bHRcIiA6IHN0b3JlO1xuXG5cdGlmICggc3RvcmUgPT09IFwiYWxsXCIgKSB7XG5cdFx0X2NhY2hlID0ge307XG5cdH0gZWxzZSB7XG5cdFx0X2NhY2hlWyBzdG9yZSBdID0ge307XG5cdH1cbn07XG5cbm1vZHVsZS5leHBvcnRzID0gbmV3IENhY2hlKCk7XG4iLCIvKiBnbG9iYWwgalF1ZXJ5ICovXG5cbnZhciBjb25maWcgPSByZXF1aXJlKCBcIi4vLi4vY29uZmlnL2NvbmZpZy5qc1wiICk7XG52YXIgZmllbGRTZWxlY3RvcnMgPSBjb25maWcuZmllbGRTZWxlY3RvcnM7XG5cbnZhciBmaWVsZF9kYXRhID0gW107XG5cbnZhciBmaWVsZHMgPSBqUXVlcnkoIFwiI3Bvc3QtYm9keSwgI2VkaXR0YWdcIiApLmZpbmQoIGZpZWxkU2VsZWN0b3JzLmpvaW4oIFwiLFwiICkgKTtcblxuZmllbGRzLmVhY2goIGZ1bmN0aW9uKCkge1xuXHR2YXIgJGVsID0galF1ZXJ5KCB0aGlzICkucGFyZW50cyggXCIuZmllbGRcIiApLmxhc3QoKTtcblxuXHRmaWVsZF9kYXRhLnB1c2goIHtcblx0XHQkZWw6ICRlbCxcblx0XHRrZXk6ICRlbC5kYXRhKCBcImZpZWxkX2tleVwiICksXG5cdFx0bmFtZTogJGVsLmRhdGEoIFwiZmllbGRfbmFtZVwiICksXG5cdFx0dHlwZTogJGVsLmRhdGEoIFwiZmllbGRfdHlwZVwiICksXG5cdFx0cG9zdF9tZXRhX2tleTogJGVsLmRhdGEoIFwiZmllbGRfbmFtZVwiICksXG5cdH0gKTtcbn0gKTtcblxubW9kdWxlLmV4cG9ydHMgPSBmaWVsZF9kYXRhO1xuIiwiLyogZ2xvYmFsIF8sIGFjZiwgalF1ZXJ5LCB3cCAqL1xubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbigpIHtcblx0dmFyIG91dGVyRmllbGRzTmFtZSA9IFtcblx0XHRcImZsZXhpYmxlX2NvbnRlbnRcIixcblx0XHRcInJlcGVhdGVyXCIsXG5cdFx0XCJncm91cFwiLFxuXHRdO1xuXG5cdHZhciBpbm5lckZpZWxkcyA9IFtdO1xuXHR2YXIgb3V0ZXJGaWVsZHMgPSBbXTtcblxuXHQvLyBSZXR1cm4gb25seSBmaWVsZHMgaW4gbWV0YWJveCBhcmVhcyAoZWl0aGVyIGJlbG93IG9yIHNpZGUpIG9yXG5cdC8vIEFDRiBibG9jayBmaWVsZHMgaW4gdGhlIGNvbnRlbnQgKG5vdCBpbiB0aGUgc2lkZWJhciwgdG8gcHJldmVudCBkdXBsaWNhdGVzKVxuXHR2YXIgcGFyZW50Q29udGFpbmVyID0galF1ZXJ5KCBcIi5tZXRhYm94LWxvY2F0aW9uLW5vcm1hbCwgLm1ldGFib3gtbG9jYXRpb24tc2lkZSwgLmFjZi1ibG9jay1jb21wb25lbnQuYWNmLWJsb2NrLWJvZHlcIiApO1xuXHR2YXIgZmllbGRzID0gXy5tYXAoIGFjZi5nZXRfZmllbGRzKCBmYWxzZSwgcGFyZW50Q29udGFpbmVyICksIGZ1bmN0aW9uKCBmaWVsZCApIHtcblx0XHR2YXIgZmllbGREYXRhID0galF1ZXJ5LmV4dGVuZCggdHJ1ZSwge30sIGFjZi5nZXRfZGF0YSggalF1ZXJ5KCBmaWVsZCApICkgKTtcblx0XHRmaWVsZERhdGEuJGVsID0galF1ZXJ5KCBmaWVsZCApO1xuXHRcdGZpZWxkRGF0YS5wb3N0X21ldGFfa2V5ID0gZmllbGREYXRhLm5hbWU7XG5cblx0XHQvLyBDb2xsZWN0IG5lc3RlZCBhbmQgcGFyZW50XG5cdFx0aWYgKCBvdXRlckZpZWxkc05hbWUuaW5kZXhPZiggZmllbGREYXRhLnR5cGUgKSA9PT0gLTEgKSB7XG5cdFx0XHRpbm5lckZpZWxkcy5wdXNoKCBmaWVsZERhdGEgKTtcblx0XHR9IGVsc2Uge1xuXHRcdFx0b3V0ZXJGaWVsZHMucHVzaCggZmllbGREYXRhICk7XG5cdFx0fVxuXG5cdFx0cmV0dXJuIGZpZWxkRGF0YTtcblx0fSApO1xuXG5cdC8vIEFkZCBBQ0YgYmxvY2sgcHJldmlld3MsIHRoZXkgYXJlIG5vdCByZXR1cm5lZCBieSBhY2YuZ2V0X2ZpZWxkcygpXG5cdC8vIEZpcnN0IGNoZWNrIGlmIHdlIGNhbiB1c2UgR3V0ZW5iZXJnLlxuXHRpZiAoIHdwLmRhdGEuc2VsZWN0KCBcImNvcmUvYmxvY2stZWRpdG9yXCIgKSApIHtcblx0XHQvLyBHdXRlbmJlcmcgaXMgYXZhaWxhYmxlLlxuXHRcdHZhciBibG9ja3MgPSB3cC5kYXRhLnNlbGVjdCggXCJjb3JlL2Jsb2NrLWVkaXRvclwiICkuZ2V0QmxvY2tzKCk7XG5cdFx0dmFyIGJsb2NrRmllbGRzID0gXy5tYXAoXG5cdFx0XHRfLmZpbHRlciggYmxvY2tzLCBmdW5jdGlvbiggYmxvY2sgKSB7XG5cdFx0XHRcdHJldHVybiBibG9jay5uYW1lLnN0YXJ0c1dpdGgoIFwiYWNmL1wiICkgJiYgYmxvY2suYXR0cmlidXRlcy5tb2RlID09PSBcInByZXZpZXdcIjtcblx0XHRcdH0gKSxcblx0XHRcdGZ1bmN0aW9uKCBibG9jayApIHtcblx0XHRcdFx0dmFyIGZpZWxkRGF0YSA9IHtcblx0XHRcdFx0XHQkZWw6IGpRdWVyeSggYFtkYXRhLWJsb2NrPVwiJHtibG9jay5jbGllbnRJZH1cIl0gLmFjZi1ibG9jay1wcmV2aWV3YCApLFxuXHRcdFx0XHRcdGtleTogYmxvY2suYXR0cmlidXRlcy5pZCxcblx0XHRcdFx0XHR0eXBlOiBcImJsb2NrX3ByZXZpZXdcIixcblx0XHRcdFx0XHRuYW1lOiBibG9jay5uYW1lLFxuXHRcdFx0XHRcdHBvc3RfbWV0YV9rZXk6IGJsb2NrLm5hbWUsXG5cdFx0XHRcdH07XG5cdFx0XHRcdGlubmVyRmllbGRzLnB1c2goIGZpZWxkRGF0YSApO1xuXHRcdFx0XHRyZXR1cm4gZmllbGREYXRhO1xuXHRcdFx0fSApO1xuXHRcdGZpZWxkcyA9IF8udW5pb24oIGZpZWxkcywgYmxvY2tGaWVsZHMgKTtcblx0fSBlbHNlIHtcblx0XHQvLyBHdXRlbmJlcmcgaXMgbm90IGF2YWlsYWJsZS4gVXNlIHRoZSBvbGQgbWV0aG9kLlxuXHRcdHZhciBpbmRleCA9IDA7XG5cdFx0ZmllbGRzID0gXy51bmlvbiggZmllbGRzLCBfLm1hcCggalF1ZXJ5KCBcIi5hY2YtYmxvY2stcHJldmlld1wiICksIGZ1bmN0aW9uKCBmaWVsZCApIHtcblx0XHRcdHZhciBmaWVsZERhdGEgPSB7XG5cdFx0XHRcdCRlbDogalF1ZXJ5KCBmaWVsZCApLFxuXHRcdFx0XHRrZXk6IG51bGwsXG5cdFx0XHRcdHR5cGU6IFwiYmxvY2tfcHJldmlld1wiLFxuXHRcdFx0XHRuYW1lOiBcImJsb2NrX3ByZXZpZXdfXCIgKyBpbmRleCxcblx0XHRcdFx0cG9zdF9tZXRhX2tleTogXCJibG9ja19wcmV2aWV3X1wiICsgaW5kZXgsXG5cdFx0XHR9O1xuXHRcdFx0aW5uZXJGaWVsZHMucHVzaCggZmllbGREYXRhICk7XG5cdFx0XHRpbmRleCsrO1xuXHRcdFx0cmV0dXJuIGZpZWxkRGF0YTtcblx0XHR9ICkgKTtcblx0fVxuXG5cdGlmICggb3V0ZXJGaWVsZHMubGVuZ3RoID09PSAwICkge1xuXHRcdHJldHVybiBmaWVsZHM7XG5cdH1cblxuXHQvLyBUcmFuc2Zvcm0gZmllbGQgbmFtZXMgZm9yIG5lc3RlZCBmaWVsZHMuXG5cdF8uZWFjaCggaW5uZXJGaWVsZHMsIGZ1bmN0aW9uKCBpbm5lciApIHtcblx0XHRfLmVhY2goIG91dGVyRmllbGRzLCBmdW5jdGlvbiggb3V0ZXIgKSB7XG5cdFx0XHRpZiAoIGpRdWVyeS5jb250YWlucyggb3V0ZXIuJGVsWyAwIF0sIGlubmVyLiRlbFsgMCBdICkgKSB7XG5cdFx0XHRcdC8vIFR5cGVzIHRoYXQgaG9sZCBtdWx0aXBsZSBjaGlsZHJlbi5cblx0XHRcdFx0aWYgKCBvdXRlci50eXBlID09PSBcImZsZXhpYmxlX2NvbnRlbnRcIiB8fCBvdXRlci50eXBlID09PSBcInJlcGVhdGVyXCIgKSB7XG5cdFx0XHRcdFx0b3V0ZXIuY2hpbGRyZW4gPSBvdXRlci5jaGlsZHJlbiB8fCBbXTtcblx0XHRcdFx0XHRvdXRlci5jaGlsZHJlbi5wdXNoKCBpbm5lciApO1xuXHRcdFx0XHRcdGlubmVyLnBhcmVudCA9IG91dGVyO1xuXHRcdFx0XHRcdGlubmVyLnBvc3RfbWV0YV9rZXkgPSBvdXRlci5uYW1lICsgXCJfXCIgKyAoIG91dGVyLmNoaWxkcmVuLmxlbmd0aCAtIDEgKSArIFwiX1wiICsgaW5uZXIubmFtZTtcblx0XHRcdFx0fVxuXG5cdFx0XHRcdC8vIFR5cGVzIHRoYXQgaG9sZCBzaW5nbGUgY2hpbGRyZW4uXG5cdFx0XHRcdGlmICggb3V0ZXIudHlwZSA9PT0gXCJncm91cFwiICkge1xuXHRcdFx0XHRcdG91dGVyLmNoaWxkcmVuID0gWyBpbm5lciBdO1xuXHRcdFx0XHRcdGlubmVyLnBhcmVudCA9IG91dGVyO1xuXHRcdFx0XHRcdGlubmVyLnBvc3RfbWV0YV9rZXkgPSBvdXRlci5uYW1lICsgXCJfXCIgKyBpbm5lci5uYW1lO1xuXHRcdFx0XHR9XG5cdFx0XHR9XG5cdFx0fSApO1xuXHR9ICk7XG5cblx0cmV0dXJuIGZpZWxkcztcbn07XG4iLCIvKiBnbG9iYWwgXyAqL1xuXG52YXIgY29uZmlnID0gcmVxdWlyZSggXCIuLy4uL2NvbmZpZy9jb25maWcuanNcIiApO1xudmFyIGhlbHBlciA9IHJlcXVpcmUoIFwiLi8uLi9oZWxwZXIuanNcIiApO1xudmFyIHNjcmFwZXJfc3RvcmUgPSByZXF1aXJlKCBcIi4vLi4vc2NyYXBlci1zdG9yZS5qc1wiICk7XG5cbnZhciBDb2xsZWN0ID0gZnVuY3Rpb24oKSB7XG5cbn07XG5cbkNvbGxlY3QucHJvdG90eXBlLmdldEZpZWxkRGF0YSA9IGZ1bmN0aW9uKCkge1xuXHR2YXIgZmllbGRfZGF0YSA9IHRoaXMuc29ydCggdGhpcy5maWx0ZXJCcm9rZW4oIHRoaXMuZmlsdGVyQmxhY2tsaXN0TmFtZSggdGhpcy5maWx0ZXJCbGFja2xpc3RUeXBlKCB0aGlzLmdldERhdGEoKSApICkgKSApO1xuXG5cdHZhciB1c2VkX3R5cGVzID0gXy51bmlxKCBfLnBsdWNrKCBmaWVsZF9kYXRhLCBcInR5cGVcIiApICk7XG5cblx0aWYgKCBjb25maWcuZGVidWcgKSB7XG5cdFx0Y29uc29sZS5sb2coIFwiVXNlZCB0eXBlczpcIiApO1xuXHRcdGNvbnNvbGUubG9nKCB1c2VkX3R5cGVzICk7XG5cdH1cblxuXHRfLmVhY2goIHVzZWRfdHlwZXMsIGZ1bmN0aW9uKCB0eXBlICkge1xuXHRcdGZpZWxkX2RhdGEgPSBzY3JhcGVyX3N0b3JlLmdldFNjcmFwZXIoIHR5cGUgKS5zY3JhcGUoIGZpZWxkX2RhdGEgKTtcblx0fSApO1xuXG5cdHJldHVybiBmaWVsZF9kYXRhO1xufTtcblxuQ29sbGVjdC5wcm90b3R5cGUuYXBwZW5kID0gZnVuY3Rpb24oIGRhdGEgKSB7XG5cdGlmICggY29uZmlnLmRlYnVnICkge1xuXHRcdGNvbnNvbGUubG9nKCBcIlJlY2FsY3VsYXRlLi4uXCIgKyBuZXcgRGF0ZSgpICk7XG5cdH1cblxuXHR2YXIgZmllbGRfZGF0YSA9IHRoaXMuZ2V0RmllbGREYXRhKCk7XG5cblx0Xy5lYWNoKCBmaWVsZF9kYXRhLCBmdW5jdGlvbiggZmllbGQgKSB7XG5cdFx0aWYgKCB0eXBlb2YgZmllbGQuY29udGVudCAhPT0gXCJ1bmRlZmluZWRcIiAmJiBmaWVsZC5jb250ZW50ICE9PSBcIlwiICkge1xuXHRcdFx0aWYgKCBmaWVsZC5vcmRlciA8IDAgKSB7XG5cdFx0XHRcdGRhdGEgPSBmaWVsZC5jb250ZW50ICsgXCJcXG5cIiArIGRhdGE7XG5cdFx0XHRcdHJldHVybjtcblx0XHRcdH1cblx0XHRcdGRhdGEgKz0gXCJcXG5cIiArIGZpZWxkLmNvbnRlbnQ7XG5cdFx0fVxuXHR9ICk7XG5cblx0aWYgKCBjb25maWcuZGVidWcgKSB7XG5cdFx0Y29uc29sZS5sb2coIFwiRmllbGQgZGF0YTpcIiApO1xuXHRcdGNvbnNvbGUudGFibGUoIGZpZWxkX2RhdGEgKTtcblxuXHRcdGNvbnNvbGUubG9nKCBcIkRhdGE6XCIgKTtcblx0XHRjb25zb2xlLmxvZyggZGF0YSApO1xuXHR9XG5cblx0cmV0dXJuIGRhdGE7XG59O1xuXG5Db2xsZWN0LnByb3RvdHlwZS5nZXREYXRhID0gZnVuY3Rpb24oKSB7XG5cdGlmICggaGVscGVyLmFjZl92ZXJzaW9uID49IDUgKSB7XG5cdFx0cmV0dXJuIHJlcXVpcmUoIFwiLi9jb2xsZWN0LXY1LmpzXCIgKSgpO1xuXHR9XG5cdHJldHVybiByZXF1aXJlKCBcIi4vY29sbGVjdC12NC5qc1wiICk7XG59O1xuXG5Db2xsZWN0LnByb3RvdHlwZS5maWx0ZXJCbGFja2xpc3RUeXBlID0gZnVuY3Rpb24oIGZpZWxkX2RhdGEgKSB7XG5cdHJldHVybiBfLmZpbHRlciggZmllbGRfZGF0YSwgZnVuY3Rpb24oIGZpZWxkICkge1xuXHRcdHJldHVybiAhIF8uY29udGFpbnMoIGNvbmZpZy5ibGFja2xpc3RUeXBlLCBmaWVsZC50eXBlICk7XG5cdH0gKTtcbn07XG5cbkNvbGxlY3QucHJvdG90eXBlLmZpbHRlckJsYWNrbGlzdE5hbWUgPSBmdW5jdGlvbiggZmllbGRfZGF0YSApIHtcblx0cmV0dXJuIF8uZmlsdGVyKCBmaWVsZF9kYXRhLCBmdW5jdGlvbiggZmllbGQgKSB7XG5cdFx0cmV0dXJuICEgXy5jb250YWlucyggY29uZmlnLmJsYWNrbGlzdE5hbWUsIGZpZWxkLm5hbWUgKTtcblx0fSApO1xufTtcblxuQ29sbGVjdC5wcm90b3R5cGUuZmlsdGVyQnJva2VuID0gZnVuY3Rpb24oIGZpZWxkX2RhdGEgKSB7XG5cdHJldHVybiBfLmZpbHRlciggZmllbGRfZGF0YSwgZnVuY3Rpb24oIGZpZWxkICkge1xuXHRcdHJldHVybiAoIFwia2V5XCIgaW4gZmllbGQgKTtcblx0fSApO1xufTtcblxuQ29sbGVjdC5wcm90b3R5cGUuc29ydCA9IGZ1bmN0aW9uKCBmaWVsZF9kYXRhICkge1xuXHRpZiAoIHR5cGVvZiBjb25maWcuZmllbGRPcmRlciA9PT0gXCJ1bmRlZmluZWRcIiB8fCAhIGNvbmZpZy5maWVsZE9yZGVyICkge1xuXHRcdHJldHVybiBmaWVsZF9kYXRhO1xuXHR9XG5cblx0Xy5lYWNoKCBmaWVsZF9kYXRhLCBmdW5jdGlvbiggZmllbGQgKSB7XG5cdFx0ZmllbGQub3JkZXIgPSAoIHR5cGVvZiBjb25maWcuZmllbGRPcmRlclsgZmllbGQua2V5IF0gPT09IFwidW5kZWZpbmVkXCIgKSA/IDAgOiBjb25maWcuZmllbGRPcmRlclsgZmllbGQua2V5IF07XG5cdH0gKTtcblxuXHRyZXR1cm4gZmllbGRfZGF0YS5zb3J0KCBmdW5jdGlvbiggYSwgYiApIHtcblx0XHRyZXR1cm4gYS5vcmRlciA+IGIub3JkZXI7XG5cdH0gKTtcbn07XG5cbm1vZHVsZS5leHBvcnRzID0gbmV3IENvbGxlY3QoKTtcbiIsIi8qIGdsb2JhbHMgWW9hc3RBQ0ZBbmFseXNpc0NvbmZpZyAqL1xubW9kdWxlLmV4cG9ydHMgPSBZb2FzdEFDRkFuYWx5c2lzQ29uZmlnO1xuIiwidmFyIGNvbmZpZyA9IHJlcXVpcmUoIFwiLi9jb25maWcvY29uZmlnLmpzXCIgKTtcblxubW9kdWxlLmV4cG9ydHMgPSB7XG5cdGFjZl92ZXJzaW9uOiBwYXJzZUZsb2F0KCBjb25maWcuYWNmVmVyc2lvbiwgMTAgKSxcbn07XG4iLCIvKiBnbG9iYWwgalF1ZXJ5LCBZb2FzdFNFTywgWW9hc3RBQ0ZBbmFseXNpczogdHJ1ZSAqL1xuLyogZXhwb3J0ZWQgWW9hc3RBQ0ZBbmFseXNpcyAqL1xuXG52YXIgQXBwID0gcmVxdWlyZSggXCIuL2FwcC5qc1wiICk7XG5cbiggZnVuY3Rpb24oICQgKSB7XG5cdCQoIGRvY3VtZW50ICkucmVhZHkoIGZ1bmN0aW9uKCkge1xuXHRcdGlmICggXCJ1bmRlZmluZWRcIiAhPT0gdHlwZW9mIFlvYXN0U0VPICkge1xuXHRcdFx0WW9hc3RBQ0ZBbmFseXNpcyA9IG5ldyBBcHAoKTtcblx0XHR9XG5cdH0gKTtcbn0oIGpRdWVyeSApICk7XG4iLCIvKiBnbG9iYWwgXywgalF1ZXJ5LCBZb2FzdFNFTywgWW9hc3RSZXBsYWNlVmFyUGx1Z2luICovXG5cbnZhciBjb25maWcgPSByZXF1aXJlKCBcIi4vY29uZmlnL2NvbmZpZy5qc1wiICk7XG5cbnZhciBSZXBsYWNlVmFyID0gWW9hc3RSZXBsYWNlVmFyUGx1Z2luLlJlcGxhY2VWYXI7XG5cbnZhciBzdXBwb3J0ZWRUeXBlcyA9IFsgXCJlbWFpbFwiLCBcInRleHRcIiwgXCJ0ZXh0YXJlYVwiLCBcInVybFwiLCBcInd5c2l3eWdcIiwgXCJibG9ja19wcmV2aWV3XCIgXTtcblxudmFyIHJlcGxhY2VWYXJzID0ge307XG5cbnZhciByZXBsYWNlVmFyUGx1Z2luQXZhaWxhYmxlID0gZnVuY3Rpb24oKSB7XG5cdGlmICggdHlwZW9mIFJlcGxhY2VWYXIgPT09IFwidW5kZWZpbmVkXCIgKSB7XG5cdFx0aWYgKCBjb25maWcuZGVidWcgKSB7XG5cdFx0XHRjb25zb2xlLmxvZyggXCJSZXBsYWNpbmcgQUNGIHZhcmlhYmxlcyBpbiB0aGUgU25pcHBldCBXaW5kb3cgcmVxdWlyZXMgWW9hc3QgU0VPID49IDUuMy5cIiApO1xuXHRcdH1cblxuXHRcdHJldHVybiBmYWxzZTtcblx0fVxuXG5cdHJldHVybiB0cnVlO1xufTtcblxudmFyIHVwZGF0ZVJlcGxhY2VWYXJzID0gZnVuY3Rpb24oIGNvbGxlY3QgKSB7XG5cdGlmICggISByZXBsYWNlVmFyUGx1Z2luQXZhaWxhYmxlKCkgKSB7XG5cdFx0cmV0dXJuO1xuXHR9XG5cblx0dmFyIGZpZWxkRGF0YSA9IF8uZmlsdGVyKCBjb2xsZWN0LmdldEZpZWxkRGF0YSgpLCBmdW5jdGlvbiggZmllbGQgKSB7XG5cdFx0cmV0dXJuIF8uY29udGFpbnMoIHN1cHBvcnRlZFR5cGVzLCBmaWVsZC50eXBlICk7XG5cdH0gKTtcblxuXHRfLmVhY2goIGZpZWxkRGF0YSwgZnVuY3Rpb24oIGZpZWxkICkge1xuXHRcdC8vIFJlbW92ZSBIVE1MIHRhZ3MgdXNpbmcgalF1ZXJ5IGluIGNhc2Ugb2YgYSB3eXNpd3lnIGZpZWxkLlxuXHRcdHZhciBjb250ZW50ID0gKCBmaWVsZC50eXBlID09PSBcInd5c2l3eWdcIiApID8galF1ZXJ5KCBqUXVlcnkucGFyc2VIVE1MKCBmaWVsZC5jb250ZW50ICkgKS50ZXh0KCkgOiBmaWVsZC5jb250ZW50O1xuXG5cdFx0aWYgKCB0eXBlb2YgcmVwbGFjZVZhcnNbIGZpZWxkLnBvc3RfbWV0YV9rZXkgXSA9PT0gXCJ1bmRlZmluZWRcIiApIHtcblx0XHRcdHJlcGxhY2VWYXJzWyBmaWVsZC5wb3N0X21ldGFfa2V5IF0gPSBuZXcgUmVwbGFjZVZhciggXCIlJWNmX1wiICsgZmllbGQucG9zdF9tZXRhX2tleSArIFwiJSVcIiwgY29udGVudCwgeyBzb3VyY2U6IFwiZGlyZWN0XCIgfSApO1xuXHRcdFx0WW9hc3RTRU8ud3AucmVwbGFjZVZhcnNQbHVnaW4uYWRkUmVwbGFjZW1lbnQoIHJlcGxhY2VWYXJzWyBmaWVsZC5wb3N0X21ldGFfa2V5IF0gKTtcblxuXHRcdFx0aWYgKCBjb25maWcuZGVidWcgKSB7XG5cdFx0XHRcdGNvbnNvbGUubG9nKCBcIkNyZWF0ZWQgUmVwbGFjZVZhciBmb3I6IFwiLCBmaWVsZC5wb3N0X21ldGFfa2V5LCBcIiB3aXRoOiBcIiwgY29udGVudCwgcmVwbGFjZVZhcnNbIGZpZWxkLnBvc3RfbWV0YV9rZXkgXSApO1xuXHRcdFx0fVxuXHRcdH0gZWxzZSB7XG5cdFx0XHRyZXBsYWNlVmFyc1sgZmllbGQucG9zdF9tZXRhX2tleSBdLnJlcGxhY2VtZW50ID0gY29udGVudDtcblxuXHRcdFx0aWYgKCBjb25maWcuZGVidWcgKSB7XG5cdFx0XHRcdGNvbnNvbGUubG9nKCBcIlVwZGF0ZWQgUmVwbGFjZVZhciBmb3I6IFwiLCBmaWVsZC5wb3N0X21ldGFfa2V5LCBcIiB3aXRoOiBcIiwgY29udGVudCwgcmVwbGFjZVZhcnNbIGZpZWxkLnBvc3RfbWV0YV9rZXkgXSApO1xuXHRcdFx0fVxuXHRcdH1cblx0fSApO1xufTtcblxubW9kdWxlLmV4cG9ydHMgPSB7XG5cdHVwZGF0ZVJlcGxhY2VWYXJzOiB1cGRhdGVSZXBsYWNlVmFycyxcbn07XG4iLCJ2YXIgY29uZmlnID0gcmVxdWlyZSggXCIuL2NvbmZpZy9jb25maWcuanNcIiApO1xuXG52YXIgc2NyYXBlck9iamVjdHMgPSB7XG5cdC8vIEJhc2ljXG5cdHRleHQ6IHJlcXVpcmUoIFwiLi9zY3JhcGVyL3NjcmFwZXIudGV4dC5qc1wiICksXG5cdHRleHRhcmVhOiByZXF1aXJlKCBcIi4vc2NyYXBlci9zY3JhcGVyLnRleHRhcmVhLmpzXCIgKSxcblx0ZW1haWw6IHJlcXVpcmUoIFwiLi9zY3JhcGVyL3NjcmFwZXIuZW1haWwuanNcIiApLFxuXHR1cmw6IHJlcXVpcmUoIFwiLi9zY3JhcGVyL3NjcmFwZXIudXJsLmpzXCIgKSxcblx0bGluazogcmVxdWlyZSggXCIuL3NjcmFwZXIvc2NyYXBlci5saW5rLmpzXCIgKSxcblxuXHQvLyBDb250ZW50XG5cdHd5c2l3eWc6IHJlcXVpcmUoIFwiLi9zY3JhcGVyL3NjcmFwZXIud3lzaXd5Zy5qc1wiICksXG5cdC8vIFRPRE86IEFkZCBvZW1iZWQgaGFuZGxlclxuXHRpbWFnZTogcmVxdWlyZSggXCIuL3NjcmFwZXIvc2NyYXBlci5pbWFnZS5qc1wiICksXG5cdGdhbGxlcnk6IHJlcXVpcmUoIFwiLi9zY3JhcGVyL3NjcmFwZXIuZ2FsbGVyeS5qc1wiICksXG5cdC8vIEFDRiBibG9ja3MgcHJldmlld1xuXHRibG9ja19wcmV2aWV3OiByZXF1aXJlKCBcIi4vc2NyYXBlci9zY3JhcGVyLmJsb2NrX3ByZXZpZXcuanNcIiApLFxuXG5cdC8vIENob2ljZVxuXHQvLyBUT0RPOiBzZWxlY3QsIGNoZWNrYm94LCByYWRpb1xuXG5cdC8vIFJlbGF0aW9uYWxcblx0dGF4b25vbXk6IHJlcXVpcmUoIFwiLi9zY3JhcGVyL3NjcmFwZXIudGF4b25vbXkuanNcIiApLFxuXG5cdC8vIFRoaXJkLXBhcnR5IC8galF1ZXJ5XG5cdC8vIFRPRE86IGdvb2dsZV9tYXAsIGRhdGVfcGlja2VyLCBjb2xvcl9waWNrZXJcblxufTtcblxudmFyIHNjcmFwZXJzID0ge307XG5cbi8qKlxuICogQ2hlY2tzIGlmIHRoZXJlIGFscmVhZHkgaXMgYSBzY3JhcGVyIGZvciBhIGZpZWxkIHR5cGUgaW4gdGhlIHN0b3JlLlxuICpcbiAqIEBwYXJhbSB7c3RyaW5nfSB0eXBlIFR5cGUgb2Ygc2NyYXBlciB0byBmaW5kLlxuICpcbiAqIEByZXR1cm5zIHtib29sZWFufSBUcnVlIGlmIHRoZSBzY3JhcGVyIGlzIGFscmVhZHkgZGVmaW5lZC5cbiAqL1xudmFyIGhhc1NjcmFwZXIgPSBmdW5jdGlvbiggdHlwZSApIHtcblx0cmV0dXJuIChcblx0XHR0eXBlIGluIHNjcmFwZXJzXG5cdCk7XG59O1xuXG4vKipcbiAqIFNldCBhIHNjcmFwZXIgb2JqZWN0IG9uIHRoZSBzdG9yZS4gRXhpc3Rpbmcgc2NyYXBlcnMgd2lsbCBiZSBvdmVyd3JpdHRlbi5cbiAqXG4gKiBAcGFyYW0ge09iamVjdH0gc2NyYXBlciBUaGUgc2NyYXBlciB0byBhZGQuXG4gKiBAcGFyYW0ge3N0cmluZ30gdHlwZSBUeXBlIG9mIHNjcmFwZXIuXG4gKlxuICogQGNoYWluYWJsZVxuICpcbiAqIEByZXR1cm5zIHtPYmplY3R9IEFkZGVkIHNjcmFwZXIuXG4gKi9cbnZhciBzZXRTY3JhcGVyID0gZnVuY3Rpb24oIHNjcmFwZXIsIHR5cGUgKSB7XG5cdGlmICggY29uZmlnLmRlYnVnICYmIGhhc1NjcmFwZXIoIHR5cGUgKSApIHtcblx0XHRjb25zb2xlLndhcm4oIFwiU2NyYXBlciBmb3IgXCIgKyB0eXBlICsgXCIgYWxyZWFkeSBleGlzdHMgYW5kIHdpbGwgYmUgb3ZlcndyaXR0ZW4uXCIgKTtcblx0fVxuXG5cdHNjcmFwZXJzWyB0eXBlIF0gPSBzY3JhcGVyO1xuXG5cdHJldHVybiBzY3JhcGVyO1xufTtcblxuLyoqXG4gKiBSZXR1cm5zIHRoZSBzY3JhcGVyIG9iamVjdCBmb3IgYSBmaWVsZCB0eXBlLlxuICogSWYgdGhlcmUgaXMgbm8gc2NyYXBlciBvYmplY3QgZm9yIHRoaXMgZmllbGQgdHlwZSBhIG5vLW9wIHNjcmFwZXIgaXMgcmV0dXJuZWQuXG4gKlxuICogQHBhcmFtIHtzdHJpbmd9IHR5cGUgVHlwZSBvZiBzY3JhcGVyIHRvIGZldGNoLlxuICpcbiAqIEByZXR1cm5zIHtPYmplY3R9IFRoZSBzY3JhcGVyIGZvciB0aGUgc3BlY2lmaWVkIHR5cGUuXG4gKi9cbnZhciBnZXRTY3JhcGVyID0gZnVuY3Rpb24oIHR5cGUgKSB7XG5cdGlmICggaGFzU2NyYXBlciggdHlwZSApICkge1xuXHRcdHJldHVybiBzY3JhcGVyc1sgdHlwZSBdO1xuXHR9XG5cblx0aWYgKCB0eXBlIGluIHNjcmFwZXJPYmplY3RzICkge1xuXHRcdHJldHVybiBzZXRTY3JhcGVyKCBuZXcgc2NyYXBlck9iamVjdHNbIHR5cGUgXSgpLCB0eXBlICk7XG5cdH1cblxuXHQvLyBJZiB3ZSBkbyBub3QgaGF2ZSBhIHNjcmFwZXIganVzdCBwYXNzIHRoZSBmaWVsZHMgdGhyb3VnaCBzbyBpdCB3aWxsIGJlIGZpbHRlcmVkIG91dCBieSB0aGUgYXBwLlxuXHRyZXR1cm4ge1xuXHRcdHNjcmFwZTogZnVuY3Rpb24oIGZpZWxkcyApIHtcblx0XHRcdGlmICggY29uZmlnLmRlYnVnICkge1xuXHRcdFx0XHRjb25zb2xlLndhcm4oIFwiTm8gU2NyYXBlciBmb3IgZmllbGQgdHlwZTogXCIgKyB0eXBlICk7XG5cdFx0XHR9XG5cdFx0XHRyZXR1cm4gZmllbGRzO1xuXHRcdH0sXG5cdH07XG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IHtcblx0c2V0U2NyYXBlcjogc2V0U2NyYXBlcixcblx0Z2V0U2NyYXBlcjogZ2V0U2NyYXBlcixcbn07XG4iLCIvKiBnbG9iYWwgXyAqL1xuXG52YXIgU2NyYXBlciA9IGZ1bmN0aW9uKCkge307XG5cblNjcmFwZXIucHJvdG90eXBlLnNjcmFwZSA9IGZ1bmN0aW9uKCBmaWVsZHMgKSB7XG5cdGZpZWxkcyA9IF8ubWFwKCBmaWVsZHMsIGZ1bmN0aW9uKCBmaWVsZCApIHtcblx0XHRpZiAoIGZpZWxkLnR5cGUgIT09IFwiYmxvY2tfcHJldmlld1wiICkge1xuXHRcdFx0cmV0dXJuIGZpZWxkO1xuXHRcdH1cblxuXHRcdGZpZWxkLmNvbnRlbnQgPSBmaWVsZC4kZWwuaHRtbCgpO1xuXG5cdFx0cmV0dXJuIGZpZWxkO1xuXHR9ICk7XG5cblx0cmV0dXJuIGZpZWxkcztcbn07XG5cbm1vZHVsZS5leHBvcnRzID0gU2NyYXBlcjtcbiIsIi8qIGdsb2JhbCBfICovXG5cbnZhciBTY3JhcGVyID0gZnVuY3Rpb24oKSB7fTtcblxuU2NyYXBlci5wcm90b3R5cGUuc2NyYXBlID0gZnVuY3Rpb24oIGZpZWxkcyApIHtcblx0ZmllbGRzID0gXy5tYXAoIGZpZWxkcywgZnVuY3Rpb24oIGZpZWxkICkge1xuXHRcdGlmICggZmllbGQudHlwZSAhPT0gXCJlbWFpbFwiICkge1xuXHRcdFx0cmV0dXJuIGZpZWxkO1xuXHRcdH1cblxuXHRcdGZpZWxkLmNvbnRlbnQgPSBmaWVsZC4kZWwuZmluZCggXCJpbnB1dFt0eXBlPWVtYWlsXVtpZF49YWNmXVwiICkudmFsKCk7XG5cblx0XHRyZXR1cm4gZmllbGQ7XG5cdH0gKTtcblxuXHRyZXR1cm4gZmllbGRzO1xufTtcblxubW9kdWxlLmV4cG9ydHMgPSBTY3JhcGVyO1xuIiwiLyogZ2xvYmFsIF8sIGpRdWVyeSAqL1xuXG52YXIgYXR0YWNobWVudENhY2hlID0gcmVxdWlyZSggXCIuLy4uL2NhY2hlL2NhY2hlLmF0dGFjaG1lbnRzLmpzXCIgKTtcblxudmFyIFNjcmFwZXIgPSBmdW5jdGlvbigpIHt9O1xuXG5TY3JhcGVyLnByb3RvdHlwZS5zY3JhcGUgPSBmdW5jdGlvbiggZmllbGRzICkge1xuXHR2YXIgYXR0YWNobWVudF9pZHMgPSBbXTtcblxuXHRmaWVsZHMgPSBfLm1hcCggZmllbGRzLCBmdW5jdGlvbiggZmllbGQgKSB7XG5cdFx0aWYgKCBmaWVsZC50eXBlICE9PSBcImdhbGxlcnlcIiApIHtcblx0XHRcdHJldHVybiBmaWVsZDtcblx0XHR9XG5cblx0XHRmaWVsZC5jb250ZW50ID0gXCJcIjtcblxuXHRcdGZpZWxkLiRlbC5maW5kKCBcIi5hY2YtZ2FsbGVyeS1hdHRhY2htZW50IGlucHV0W3R5cGU9aGlkZGVuXVwiICkuZWFjaCggZnVuY3Rpb24oKSB7XG5cdFx0XHQvLyBUT0RPOiBJcyB0aGlzIHRoZSBiZXN0IHdheSB0byBnZXQgdGhlIGF0dGFjaG1lbnQgaWQ/XG5cdFx0XHR2YXIgYXR0YWNobWVudF9pZCA9IGpRdWVyeSggdGhpcyApLnZhbCgpO1xuXG5cdFx0XHQvLyBDb2xsZWN0IGFsbCBhdHRhY2htZW50IGlkcyBmb3IgY2FjaGUgcmVmcmVzaFxuXHRcdFx0YXR0YWNobWVudF9pZHMucHVzaCggYXR0YWNobWVudF9pZCApO1xuXG5cdFx0XHQvLyBJZiB3ZSBoYXZlIHRoZSBhdHRhY2htZW50IGRhdGEgaW4gdGhlIGNhY2hlIHdlIGNhbiByZXR1cm4gYSB1c2VmdWwgdmFsdWVcblx0XHRcdGlmICggYXR0YWNobWVudENhY2hlLmdldCggYXR0YWNobWVudF9pZCwgXCJhdHRhY2htZW50XCIgKSApIHtcblx0XHRcdFx0dmFyIGF0dGFjaG1lbnQgPSBhdHRhY2htZW50Q2FjaGUuZ2V0KCBhdHRhY2htZW50X2lkLCBcImF0dGFjaG1lbnRcIiApO1xuXG5cdFx0XHRcdGZpZWxkLmNvbnRlbnQgKz0gJzxpbWcgc3JjPVwiJyArIGF0dGFjaG1lbnQudXJsICsgJ1wiIGFsdD1cIicgKyBhdHRhY2htZW50LmFsdCArICdcIiB0aXRsZT1cIicgKyBhdHRhY2htZW50LnRpdGxlICsgJ1wiPic7XG5cdFx0XHR9XG5cdFx0fSApO1xuXG5cdFx0cmV0dXJuIGZpZWxkO1xuXHR9ICk7XG5cblx0YXR0YWNobWVudENhY2hlLnJlZnJlc2goIGF0dGFjaG1lbnRfaWRzICk7XG5cblx0cmV0dXJuIGZpZWxkcztcbn07XG5cbm1vZHVsZS5leHBvcnRzID0gU2NyYXBlcjtcbiIsIi8qIGdsb2JhbCBfICovXG5cbnZhciBhdHRhY2htZW50Q2FjaGUgPSByZXF1aXJlKCBcIi4vLi4vY2FjaGUvY2FjaGUuYXR0YWNobWVudHMuanNcIiApO1xuXG52YXIgU2NyYXBlciA9IGZ1bmN0aW9uKCkge307XG5cblNjcmFwZXIucHJvdG90eXBlLnNjcmFwZSA9IGZ1bmN0aW9uKCBmaWVsZHMgKSB7XG5cdHZhciBhdHRhY2htZW50X2lkcyA9IFtdO1xuXG5cdGZpZWxkcyA9IF8ubWFwKCBmaWVsZHMsIGZ1bmN0aW9uKCBmaWVsZCApIHtcblx0XHRpZiAoIGZpZWxkLnR5cGUgIT09IFwiaW1hZ2VcIiApIHtcblx0XHRcdHJldHVybiBmaWVsZDtcblx0XHR9XG5cblx0XHRmaWVsZC5jb250ZW50ID0gXCJcIjtcblxuXHRcdHZhciBhdHRhY2htZW50X2lkID0gZmllbGQuJGVsLmZpbmQoIFwiaW5wdXRbdHlwZT1oaWRkZW5dXCIgKS52YWwoKTtcblxuXHRcdGF0dGFjaG1lbnRfaWRzLnB1c2goIGF0dGFjaG1lbnRfaWQgKTtcblxuXHRcdGlmICggYXR0YWNobWVudENhY2hlLmdldCggYXR0YWNobWVudF9pZCwgXCJhdHRhY2htZW50XCIgKSApIHtcblx0XHRcdHZhciBhdHRhY2htZW50ID0gYXR0YWNobWVudENhY2hlLmdldCggYXR0YWNobWVudF9pZCwgXCJhdHRhY2htZW50XCIgKTtcblxuXHRcdFx0ZmllbGQuY29udGVudCArPSAnPGltZyBzcmM9XCInICsgYXR0YWNobWVudC51cmwgKyAnXCIgYWx0PVwiJyArIGF0dGFjaG1lbnQuYWx0ICsgJ1wiIHRpdGxlPVwiJyArIGF0dGFjaG1lbnQudGl0bGUgKyAnXCI+Jztcblx0XHR9XG5cblxuXHRcdHJldHVybiBmaWVsZDtcblx0fSApO1xuXG5cdGF0dGFjaG1lbnRDYWNoZS5yZWZyZXNoKCBhdHRhY2htZW50X2lkcyApO1xuXG5cdHJldHVybiBmaWVsZHM7XG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IFNjcmFwZXI7XG4iLCIvKiBnbG9iYWwgXyAqL1xucmVxdWlyZSggXCIuLy4uL3NjcmFwZXItc3RvcmUuanNcIiApO1xuXG52YXIgU2NyYXBlciA9IGZ1bmN0aW9uKCkge307XG5cbi8qKlxuICogU2NyYXBlciBmb3IgdGhlIGxpbmsgZmllbGQgdHlwZS5cbiAqXG4gKiBAcGFyYW0ge09iamVjdH0gZmllbGRzIEZpZWxkcyB0byBwYXJzZS5cbiAqXG4gKiBAcmV0dXJucyB7T2JqZWN0fSBNYXBwZWQgbGlzdCBvZiBmaWVsZHMuXG4gKi9cblNjcmFwZXIucHJvdG90eXBlLnNjcmFwZSA9IGZ1bmN0aW9uKCBmaWVsZHMgKSB7XG5cdC8qKlxuXHQgKiBTZXQgY29udGVudCBmb3IgYWxsIGxpbmsgZmllbGRzIGFzIGEtdGFnIHdpdGggdGl0bGUsIHVybCBhbmQgdGFyZ2V0LlxuXHQgKiBSZXR1cm4gdGhlIGZpZWxkcyBvYmplY3QgY29udGFpbmluZyBhbGwgZmllbGRzLlxuXHQgKi9cblx0cmV0dXJuIF8ubWFwKCBmaWVsZHMsIGZ1bmN0aW9uKCBmaWVsZCApIHtcblx0XHRpZiAoIGZpZWxkLnR5cGUgIT09IFwibGlua1wiICkge1xuXHRcdFx0cmV0dXJuIGZpZWxkO1xuXHRcdH1cblxuXHRcdHZhciB0aXRsZSA9IGZpZWxkLiRlbC5maW5kKCBcImlucHV0W3R5cGU9aGlkZGVuXS5pbnB1dC10aXRsZVwiICkudmFsKCksXG5cdFx0XHR1cmwgPSBmaWVsZC4kZWwuZmluZCggXCJpbnB1dFt0eXBlPWhpZGRlbl0uaW5wdXQtdXJsXCIgKS52YWwoKSxcblx0XHRcdHRhcmdldCA9IGZpZWxkLiRlbC5maW5kKCBcImlucHV0W3R5cGU9aGlkZGVuXS5pbnB1dC10YXJnZXRcIiApLnZhbCgpO1xuXG5cdFx0ZmllbGQuY29udGVudCA9IFwiPGEgaHJlZj1cXFwiXCIgKyB1cmwgKyBcIlxcXCIgdGFyZ2V0PVxcXCJcIiArIHRhcmdldCArIFwiXFxcIj5cIiArIHRpdGxlICsgXCI8L2E+XCI7XG5cblx0XHRyZXR1cm4gZmllbGQ7XG5cdH0gKTtcbn07XG5cbm1vZHVsZS5leHBvcnRzID0gU2NyYXBlcjtcbiIsIi8qIGdsb2JhbCBfLCBhY2YgKi9cblxudmFyIFNjcmFwZXIgPSBmdW5jdGlvbigpIHt9O1xuXG5TY3JhcGVyLnByb3RvdHlwZS5zY3JhcGUgPSBmdW5jdGlvbiggZmllbGRzICkge1xuXHRmaWVsZHMgPSBfLm1hcCggZmllbGRzLCBmdW5jdGlvbiggZmllbGQgKSB7XG5cdFx0aWYgKCBmaWVsZC50eXBlICE9PSBcInRheG9ub215XCIgKSB7XG5cdFx0XHRyZXR1cm4gZmllbGQ7XG5cdFx0fVxuXG5cdFx0dmFyIHRlcm1zID0gW107XG5cblx0XHRpZiAoIGZpZWxkLiRlbC5maW5kKCAnLmFjZi10YXhvbm9teS1maWVsZFtkYXRhLXR5cGU9XCJtdWx0aV9zZWxlY3RcIl0nICkubGVuZ3RoID4gMCApIHtcblx0XHRcdHZhciBzZWxlY3QyVGFyZ2V0ID0gKCBhY2Yuc2VsZWN0Mi52ZXJzaW9uID49IDQgKSA/IFwic2VsZWN0XCIgOiBcImlucHV0XCI7XG5cblx0XHRcdHRlcm1zID0gXy5wbHVjayhcblx0XHRcdFx0ZmllbGQuJGVsLmZpbmQoICcuYWNmLXRheG9ub215LWZpZWxkW2RhdGEtdHlwZT1cIm11bHRpX3NlbGVjdFwiXSAnICsgc2VsZWN0MlRhcmdldCApXG5cdFx0XHRcdFx0LnNlbGVjdDIoIFwiZGF0YVwiIClcblx0XHRcdFx0LCBcInRleHRcIlxuXHRcdFx0KTtcblx0XHR9IGVsc2UgaWYgKCBmaWVsZC4kZWwuZmluZCggJy5hY2YtdGF4b25vbXktZmllbGRbZGF0YS10eXBlPVwiY2hlY2tib3hcIl0nICkubGVuZ3RoID4gMCApIHtcblx0XHRcdHRlcm1zID0gXy5wbHVjayhcblx0XHRcdFx0ZmllbGQuJGVsLmZpbmQoICcuYWNmLXRheG9ub215LWZpZWxkW2RhdGEtdHlwZT1cImNoZWNrYm94XCJdIGlucHV0W3R5cGU9XCJjaGVja2JveFwiXTpjaGVja2VkJyApXG5cdFx0XHRcdFx0Lm5leHQoKSxcblx0XHRcdFx0XCJ0ZXh0Q29udGVudFwiXG5cdFx0XHQpO1xuXHRcdH0gZWxzZSBpZiAoIGZpZWxkLiRlbC5maW5kKCBcImlucHV0W3R5cGU9Y2hlY2tib3hdOmNoZWNrZWRcIiApLmxlbmd0aCA+IDAgKSB7XG5cdFx0XHR0ZXJtcyA9IF8ucGx1Y2soXG5cdFx0XHRcdGZpZWxkLiRlbC5maW5kKCBcImlucHV0W3R5cGU9Y2hlY2tib3hdOmNoZWNrZWRcIiApXG5cdFx0XHRcdFx0LnBhcmVudCgpLFxuXHRcdFx0XHRcInRleHRDb250ZW50XCJcblx0XHRcdCk7XG5cdFx0fSBlbHNlIGlmICggZmllbGQuJGVsLmZpbmQoIFwic2VsZWN0IG9wdGlvbjpjaGVja2VkXCIgKS5sZW5ndGggPiAwICkge1xuXHRcdFx0dGVybXMgPSBfLnBsdWNrKFxuXHRcdFx0XHRmaWVsZC4kZWwuZmluZCggXCJzZWxlY3Qgb3B0aW9uOmNoZWNrZWRcIiApLFxuXHRcdFx0XHRcInRleHRDb250ZW50XCJcblx0XHRcdCk7XG5cdFx0fVxuXG5cdFx0dGVybXMgPSBfLm1hcCggdGVybXMsIGZ1bmN0aW9uKCB0ZXJtICkge1xuXHRcdFx0cmV0dXJuIHRlcm0udHJpbSgpO1xuXHRcdH0gKTtcblxuXHRcdGlmICggdGVybXMubGVuZ3RoID4gMCApIHtcblx0XHRcdGZpZWxkLmNvbnRlbnQgPSBcIjx1bD5cXG48bGk+XCIgKyB0ZXJtcy5qb2luKCBcIjwvbGk+XFxuPGxpPlwiICkgKyBcIjwvbGk+XFxuPC91bD5cIjtcblx0XHR9XG5cblx0XHRyZXR1cm4gZmllbGQ7XG5cdH0gKTtcblxuXHRyZXR1cm4gZmllbGRzO1xufTtcblxubW9kdWxlLmV4cG9ydHMgPSBTY3JhcGVyO1xuIiwiLyogZ2xvYmFsIF8gKi9cblxudmFyIGNvbmZpZyA9IHJlcXVpcmUoIFwiLi8uLi9jb25maWcvY29uZmlnLmpzXCIgKTtcblxudmFyIFNjcmFwZXIgPSBmdW5jdGlvbigpIHt9O1xuXG5TY3JhcGVyLnByb3RvdHlwZS5zY3JhcGUgPSBmdW5jdGlvbiggZmllbGRzICkge1xuXHR2YXIgdGhhdCA9IHRoaXM7XG5cblx0ZmllbGRzID0gXy5tYXAoIGZpZWxkcywgZnVuY3Rpb24oIGZpZWxkICkge1xuXHRcdGlmICggZmllbGQudHlwZSAhPT0gXCJ0ZXh0XCIgKSB7XG5cdFx0XHRyZXR1cm4gZmllbGQ7XG5cdFx0fVxuXG5cdFx0ZmllbGQuY29udGVudCA9IGZpZWxkLiRlbC5maW5kKCBcImlucHV0W3R5cGU9dGV4dF1baWRePWFjZl1cIiApLnZhbCgpO1xuXHRcdGZpZWxkID0gdGhhdC53cmFwSW5IZWFkbGluZSggZmllbGQgKTtcblxuXHRcdHJldHVybiBmaWVsZDtcblx0fSApO1xuXG5cdHJldHVybiBmaWVsZHM7XG59O1xuXG5TY3JhcGVyLnByb3RvdHlwZS53cmFwSW5IZWFkbGluZSA9IGZ1bmN0aW9uKCBmaWVsZCApIHtcblx0dmFyIGxldmVsID0gdGhpcy5pc0hlYWRsaW5lKCBmaWVsZCApO1xuXHRpZiAoIGxldmVsICkge1xuXHRcdGZpZWxkLmNvbnRlbnQgPSBcIjxoXCIgKyBsZXZlbCArIFwiPlwiICsgZmllbGQuY29udGVudCArIFwiPC9oXCIgKyBsZXZlbCArIFwiPlwiO1xuXHR9IGVsc2Uge1xuXHRcdGZpZWxkLmNvbnRlbnQgPSBcIjxwPlwiICsgZmllbGQuY29udGVudCArIFwiPC9wPlwiO1xuXHR9XG5cblx0cmV0dXJuIGZpZWxkO1xufTtcblxuU2NyYXBlci5wcm90b3R5cGUuaXNIZWFkbGluZSA9IGZ1bmN0aW9uKCBmaWVsZCApIHtcblx0dmFyIGxldmVsID0gXy5maW5kKCBjb25maWcuc2NyYXBlci50ZXh0LmhlYWRsaW5lcywgZnVuY3Rpb24oIHZhbHVlLCBrZXkgKSB7XG5cdFx0cmV0dXJuIGZpZWxkLmtleSA9PT0ga2V5O1xuXHR9ICk7XG5cblx0Ly8gSXQgaGFzIHRvIGJlIGFuIGludGVnZXJcblx0aWYgKCBsZXZlbCApIHtcblx0XHRsZXZlbCA9IHBhcnNlSW50KCBsZXZlbCwgMTAgKTtcblx0fVxuXG5cdC8vIEhlYWRsaW5lcyBvbmx5IGV4aXN0IGZyb20gaDEgdG8gaDZcblx0aWYgKCBsZXZlbCA8IDEgfHwgbGV2ZWwgPiA2ICkge1xuXHRcdGxldmVsID0gZmFsc2U7XG5cdH1cblxuXHRyZXR1cm4gbGV2ZWw7XG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IFNjcmFwZXI7XG4iLCIvKiBnbG9iYWwgXyAqL1xuXG52YXIgU2NyYXBlciA9IGZ1bmN0aW9uKCkge307XG5cblNjcmFwZXIucHJvdG90eXBlLnNjcmFwZSA9IGZ1bmN0aW9uKCBmaWVsZHMgKSB7XG5cdGZpZWxkcyA9IF8ubWFwKCBmaWVsZHMsIGZ1bmN0aW9uKCBmaWVsZCApIHtcblx0XHRpZiAoIGZpZWxkLnR5cGUgIT09IFwidGV4dGFyZWFcIiApIHtcblx0XHRcdHJldHVybiBmaWVsZDtcblx0XHR9XG5cblx0XHRmaWVsZC5jb250ZW50ID0gXCI8cD5cIiArIGZpZWxkLiRlbC5maW5kKCBcInRleHRhcmVhW2lkXj1hY2ZdXCIgKS52YWwoKSArIFwiPC9wPlwiO1xuXG5cdFx0cmV0dXJuIGZpZWxkO1xuXHR9ICk7XG5cblx0cmV0dXJuIGZpZWxkcztcbn07XG5cbm1vZHVsZS5leHBvcnRzID0gU2NyYXBlcjtcbiIsIi8qIGdsb2JhbCBfICovXG5cbnZhciBTY3JhcGVyID0gZnVuY3Rpb24oKSB7fTtcblxuU2NyYXBlci5wcm90b3R5cGUuc2NyYXBlID0gZnVuY3Rpb24oIGZpZWxkcyApIHtcblx0ZmllbGRzID0gXy5tYXAoIGZpZWxkcywgZnVuY3Rpb24oIGZpZWxkICkge1xuXHRcdGlmICggZmllbGQudHlwZSAhPT0gXCJ1cmxcIiApIHtcblx0XHRcdHJldHVybiBmaWVsZDtcblx0XHR9XG5cblx0XHR2YXIgY29udGVudCA9IGZpZWxkLiRlbC5maW5kKCBcImlucHV0W3R5cGU9dXJsXVtpZF49YWNmXVwiICkudmFsKCk7XG5cblx0XHRmaWVsZC5jb250ZW50ID0gY29udGVudCA/ICc8YSBocmVmPVwiJyArIGNvbnRlbnQgKyAnXCI+JyArIGNvbnRlbnQgKyBcIjwvYT5cIiA6IFwiXCI7XG5cblx0XHRyZXR1cm4gZmllbGQ7XG5cdH0gKTtcblxuXHRyZXR1cm4gZmllbGRzO1xufTtcblxubW9kdWxlLmV4cG9ydHMgPSBTY3JhcGVyO1xuIiwiLyogZ2xvYmFsIHRpbnlNQ0UsIF8gKi9cblxudmFyIFNjcmFwZXIgPSBmdW5jdGlvbigpIHt9O1xuXG4vKipcbiAqIEFkYXB0ZWQgZnJvbSB3cC1zZW8tcG9zdC1zY3JhcGVyLXBsdWdpbi0zMTAuanM6MTk2LTIxMFxuICpcbiAqIEBwYXJhbSB7c3RyaW5nfSBlZGl0b3JJRCBUaW55TUNFIGlkZW50aWZpZXIgdG8gbG9vayB1cC5cbiAqXG4gKiBAcmV0dXJucyB7Ym9vbGVhbn0gVHJ1ZSBpZiBhbiBlZGl0b3IgZXhpc3RzIGZvciB0aGUgc3VwcGxpZWQgSUQuXG4gKi9cbnZhciBpc1RpbnlNQ0VBdmFpbGFibGUgPSBmdW5jdGlvbiggZWRpdG9ySUQgKSB7XG5cdGlmICggdHlwZW9mIHRpbnlNQ0UgPT09IFwidW5kZWZpbmVkXCIgfHxcblx0XHQgdHlwZW9mIHRpbnlNQ0UuZWRpdG9ycyA9PT0gXCJ1bmRlZmluZWRcIiB8fFxuXHRcdCB0aW55TUNFLmVkaXRvcnMubGVuZ3RoID09PSAwIHx8XG5cdFx0IHRpbnlNQ0UuZ2V0KCBlZGl0b3JJRCApID09PSBudWxsIHx8XG5cdFx0IHRpbnlNQ0UuZ2V0KCBlZGl0b3JJRCApLmlzSGlkZGVuKCkgKSB7XG5cdFx0cmV0dXJuIGZhbHNlO1xuXHR9XG5cblx0cmV0dXJuIHRydWU7XG59O1xuXG4vKipcbiAqIEFkYXB0ZWQgZnJvbSB3cC1zZW8tc2hvcnRjb2RlLXBsdWdpbi0zMDUuanM6MTE1LTEyNlxuICpcbiAqIEBwYXJhbSB7T2JqZWN0fSBmaWVsZCBGaWVsZCB0byBnZXQgdGhlIGNvbnRlbnQgZm9yLlxuICpcbiAqIEByZXR1cm5zIHtzdHJpbmd9IFRoZSBjb250ZW50IG9mIHRoZSBmaWVsZC5cbiAqL1xudmFyIGdldENvbnRlbnRUaW55TUNFID0gZnVuY3Rpb24oIGZpZWxkICkge1xuXHR2YXIgdGV4dGFyZWEgPSBmaWVsZC4kZWwuZmluZCggXCJ0ZXh0YXJlYVwiIClbIDAgXTtcblx0dmFyIGVkaXRvcklEID0gdGV4dGFyZWEuaWQ7XG5cdHZhciB2YWwgPSB0ZXh0YXJlYS52YWx1ZTtcblxuXHRpZiAoIGlzVGlueU1DRUF2YWlsYWJsZSggZWRpdG9ySUQgKSApIHtcblx0XHR2YWwgPSB0aW55TUNFLmdldCggZWRpdG9ySUQgKSAmJiB0aW55TUNFLmdldCggZWRpdG9ySUQgKS5nZXRDb250ZW50KCkgfHwgXCJcIjtcblx0fVxuXG5cdHJldHVybiB2YWw7XG59O1xuXG5TY3JhcGVyLnByb3RvdHlwZS5zY3JhcGUgPSBmdW5jdGlvbiggZmllbGRzICkge1xuXHRmaWVsZHMgPSBfLm1hcCggZmllbGRzLCBmdW5jdGlvbiggZmllbGQgKSB7XG5cdFx0aWYgKCBmaWVsZC50eXBlICE9PSBcInd5c2l3eWdcIiApIHtcblx0XHRcdHJldHVybiBmaWVsZDtcblx0XHR9XG5cblx0XHRmaWVsZC5jb250ZW50ID0gZ2V0Q29udGVudFRpbnlNQ0UoIGZpZWxkICk7XG5cblx0XHRyZXR1cm4gZmllbGQ7XG5cdH0gKTtcblxuXHRyZXR1cm4gZmllbGRzO1xufTtcblxubW9kdWxlLmV4cG9ydHMgPSBTY3JhcGVyO1xuIl19
