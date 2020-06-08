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
