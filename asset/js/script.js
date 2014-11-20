// functions
var determine_media_to_migrate;
var remote_media_files_unavailable = false;
var remote_connection_data;
var connection_info;
var media_successfully_determined;

(function($) {

	// .length doesn't work on JS "associative arrays" i.e. objects with key/value elements, this does
	Object.size = function(obj) {
		var size = 0, key;
		for (key in obj) {
			if (obj.hasOwnProperty(key)) size++;
		}
		return size;
	};

	$(document).ready(function() {

		if( migration_type() == 'savefile' ){
			$('.media-files-options').hide();
		}

		var disable_media_files_option = function() {
			$('#media-files').attr('data-available', '0');
			$('#media-files').prop('checked',false);
			$('#media-files').attr('disabled','disabled');
			$('.media-files').addClass('disabled');
			$('.media-files-options .expandable-content').hide();
		};

		var hide_show_options = function( unavailable ) {
			var mig_type = migration_type();

			if( 'savefile' == mig_type ){
				$('.media-files-options').hide();
				return;
			}

			$('.media-files-options').show();
			$('.media-files-push').hide();

			if ( unavailable ) {
				$('.media-files-options ul').hide();
				$('.media-migration-unavailable').show();
				disable_media_files_option();
				return;
			}

			if( typeof remote_connection_data != 'undefined' && wpmdb_media_files_version != remote_connection_data.media_files_version ) {
				$('.media-files-remote-location').html(remote_connection_data.url);
				$('.media-file-remote-version').html(remote_connection_data.media_files_version);
				$('.media-files-different-plugin-version-notice').show();
				disable_media_files_option();
				return;
			}

			$('.media-files-options ul').show();
			$('.media-migration-unavailable').hide();
			$('.media-files-different-plugin-version-notice').hide();
			$('#media-files').removeAttr('disabled');
			$('.media-files').removeClass('disabled');
			$('#media-files').attr('data-available', '1');
		};

		$.wpmdb.add_action( 'move_connection_info_box', function() { 
			hide_show_options( remote_media_files_unavailable );
			action_text_toggle();
		});

		$.wpmdb.add_action( 'verify_connection_to_remote_site', function( connection_data ) {
			remote_connection_data = connection_data;
			remote_media_files_unavailable = ( typeof connection_data.media_files_available == 'undefined' );
			hide_show_options( remote_media_files_unavailable );
		});

		$.wpmdb.add_filter('wpmdb_before_migration_complete_hooks',function(hooks) {
			if( false == is_media_migration() || 'savefile' == migration_type() ) return hooks;
			hooks.push( 'determine_media_to_migrate' );
			return hooks;
		});

		determine_media_to_migrate = function() {
			connection_info = $.trim( $('.pull-push-connection-info').val() ).split("\n");

			var remove_local_media = 0;
			var copy_entire_media = 0;

			var media_type = $('input[name="media_migration_option"]:checked').val();

			if ( 'compare' == media_type ) {
				$('.progress-text').html( wpmdbmf_strings.determining );

				if( $('#remove-local-media').is(':checked') ) {
					remove_local_media = 1;
				}
			} else {
				$('.progress-text').html( wpmdbmf_strings.migrating_media_files );
				copy_entire_media = 1;
			}

			$.ajax({
				url: 		ajaxurl,
				type: 		'POST',
				dataType:	'text',
				cache: 	false,
				data: {
					action: 			'wpmdbmf_determine_media_to_migrate',
					remove_local_media:	remove_local_media,
					copy_entire_media:	copy_entire_media,
					intent:				migration_type(),
					url: 				connection_info[0],
					key: 				connection_info[1],
					temp_prefix:		connection_data.temp_prefix,
					nonce:				wpmdb_nonces.determine_media_to_migrate,
				},
				error: function(jqXHR, textStatus, errorThrown){
					$('.progress-title').html( wpmdbmf_strings.migration_failed );
					$('.progress-text').html( wpmdbGetAjaxErrors( wpmdbmf_strings.error_determining, '(#101mf)', jqXHR.responseText, jqXHR ) );
					$('.progress-text').addClass('migration-error');
					console.log( jqXHR );
					console.log( textStatus );
					console.log( errorThrown );
					migration_error = true;
					migration_complete_events();
					return;
				},
				success: function(data){
					original_data = data;
					data = wpmdb_parse_json( $.trim( data ) );
					if( false == data ) {
						migration_failed( original_data );
						return;
					}

					next_step_in_migration = { fn: media_successfully_determined, args: [ data ] };
					execute_next_step();
				}

			});

		}

		function migration_failed( data ) {
			$('.progress-title').html( wpmdbmf_strings.migration_failed );
			$('.progress-text').html( wpmdbGetAjaxErrors( '', '', data ) );
			$('.progress-text').addClass('migration-error');
			migration_error = true;
			migration_complete_events();
		}

		media_successfully_determined = function( data ) {
			if( typeof data.wpmdb_error != 'undefined' && data.wpmdb_error == 1 ){
				non_fatal_errors += data.body;
				next_step_in_migration = { fn: wpmdb_call_next_hook };
				execute_next_step();
				return;
			}

			var args = {};
			args.media_progress = 0;
			args.media_progress_image_number = 0;
			args.media_total_size = data.total_size;
			args.remote_uploads_url = data.remote_uploads_url;
			args.files_to_migrate = data.files_to_migrate;

			args.bottleneck = wpmdb_max_request;

			if( Object.size( args.files_to_migrate ) > 0 ) {
				$('.progress-bar').width('0px');
			}

			$('.progress-tables').empty();
			$('.progress-tables-hover-boxes').empty();

			$('.progress-tables').prepend('<div title="' + wpmdbmf_strings.media_files + '" style="width: 100%;" class="progress-chunk media_files"><span>' + wpmdbmf_strings.media_files + ' (<span class="media-migration-current-image">0</span> / ' + wpmdb_add_commas( Object.size( args.files_to_migrate ) ) + ')</span></div>');

			next_step_in_migration = { fn: migrate_media_files_recursive, args: [ args ] };
			execute_next_step();
		}

		function migrate_media_files_recursive( args ) {
			if( 0 == Object.size( args.files_to_migrate ) ) {
				wpmdb_call_next_hook();
				return;
			}

			var file_chunk_to_migrate = [];
			var file_chunk_size = 0;
			var number_of_files_to_migrate = 0;

			$.each( args.files_to_migrate, function( index, value ) {
				if( ! file_chunk_to_migrate.length ) {
					file_chunk_to_migrate.push( index );
					file_chunk_size += value;
					delete args.files_to_migrate[index];
					++args.media_progress_image_number;
					++number_of_files_to_migrate;
				}
				else {
					if( ( file_chunk_size + value ) > args.bottleneck || number_of_files_to_migrate >= remote_connection_data.media_files_max_file_uploads ) {
						return false;
					}
					else {
						file_chunk_to_migrate.push( index );
						file_chunk_size += value;
						delete args.files_to_migrate[index];
						++args.media_progress_image_number;
						++number_of_files_to_migrate;
					}
				}
			});

			var connection_info = $.trim( $('.pull-push-connection-info').val() ).split("\n");

			$.ajax({
				url: 		ajaxurl,
				type: 		'POST',
				dataType:	'text',
				cache: 	false,
				data: {
					action: 			'wpmdbmf_migrate_media',
					file_chunk:			file_chunk_to_migrate,
					remote_uploads_url: args.remote_uploads_url,
					intent:				migration_type(),
					url: 				connection_info[0],
					key: 				connection_info[1],
					nonce:				wpmdb_nonces.migrate_media,
				},
				error: function(jqXHR, textStatus, errorThrown){
					$('.progress-title').html('Migration failed');
					$('.progress-text').html( wpmdbGetAjaxErrors( wpmdbmf_strings.problem_migrating_media, '(#102mf)', jqXHR.responseText, jqXHR ) );
					$('.progress-text').addClass('migration-error');
					console.log( jqXHR );
					console.log( textStatus );
					console.log( errorThrown );
					migration_error = true;
					migration_complete_events();
					return;
				},
				success: function(data){
					original_data = data;
					data = wpmdb_parse_json( $.trim( data ) );
					if( false == data ) {
						migration_failed( original_data );
						return;
					}

					if( typeof data.wpmdb_error != 'undefined' && data.wpmdb_error == 1 ){
						non_fatal_errors += data.body;
					}

					args.media_progress += file_chunk_size;

					var percent = 100 * args.media_progress / args.media_total_size;
					$('.progress-bar').width(percent + '%');
					overall_percent = Math.floor(percent);

					$('.progress-text').html(overall_percent + '% - ' + wpmdbmf_strings.migrating_media_files);
					$('.media-migration-current-image').html( wpmdb_add_commas( args.media_progress_image_number ) );

					next_step_in_migration = { fn: migrate_media_files_recursive, args: [ args ] };
					execute_next_step();
				}

			});

		}

		function is_media_migration() {
			return $('#media-files').attr('data-available') == '1' && $('#media-files').is(':checked') ? true : false;
		}

		function migration_type() {
			return $('input[name=action]:checked').val();	
		}

		function action_text_toggle() {
			$('.action-text').hide();
			$('.action-text.' + migration_type() ).show();
		}

		$('input[name="media_migration_option"]').change(function () {
			if ($(this).is(':checked') && $(this).val() == 'entire') {
				$('#remove-local-media').prop("disabled", true);
				$('#remove-local-media').prop("checked", false);
			} else {
				$('#remove-local-media').prop("disabled", false);
			}
		});

	});

})(jQuery);