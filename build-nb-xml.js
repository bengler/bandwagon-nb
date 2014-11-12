module.exports = buildXML;
var builder = require('xmlbuilder');
var debug = require("debug")('bandwagon-nb');

const EMPTY = '';

function formatName(object) {
  return object.name
}

function buildXML(year, entry) {
  var data = {
    DigitalMediaId: {
      SongTitle: entry.track.document.name,
      Artist: entry.artist.document.name,
      Rightsholder: (entry.track.document.author || entry.uploadedBy.profile.name),
      Project: 'Bandwagon ' + year,
      RevisionNumber: 'R01',
      MediaType: 'DIS',
      MasterType: 'Amedia',
      Date: year,
      GeneralNotes: EMPTY,
      FileInfo: {
        SampleRate: EMPTY,
        BitDepth: EMPTY,
        MD5Checksum: EMPTY,
        Length: EMPTY,
        FileFormat: EMPTY,
        Tracks: EMPTY,
        ReferenceLevel: EMPTY,
        LoudnessNormalizationLevel: EMPTY,
        LoudnessRange: EMPTY,
        TruePeak: EMPTY
      },
      Credits: {
        Writers: EMPTY,
        Performers: (entry.artist.document.members || []).map(formatName).join(';'),
        Producers: EMPTY,
        TrackingStudios: EMPTY,
        TrackingEngineers: EMPTY,
        MixingStudios: EMPTY,
        MixingEngineers: EMPTY,
        MasteringStudios: EMPTY,
        MasteringEngineers: EMPTY,
        CreditNotes: EMPTY
      },
      Relations: {
        Album: EMPTY,
        ArchiveTitleNumber: EMPTY,
        ArchiveSegmentNumber: EMPTY,
        ISRC: EMPTY,
        Source: entry.publication.title
      },
      ExternalDocuments: {
        CueSheet: EMPTY,
        SessionInfo: EMPTY,
        OtherDocuments: JSON.stringify({
          year: entry.year,
          artist: entry.artist.document,
          track: entry.track.document
        }, null, 2)
      },
      Studio: {
        Studio: EMPTY,
        DAWProgram: EMPTY,
        HostComputer: EMPTY,
        DAWSoftwareVersion: EMPTY,
        SampleRate: EMPTY,
        BitDepth: EMPTY,
        SyncSource: EMPTY,
        HostComputerOperatingSystem: EMPTY,
        OriginalFormat: EMPTY,
        ADConversion: EMPTY,
        StorageMedia: EMPTY,
        Monitoring: EMPTY,
        Console: EMPTY,
        ConsoleAutomation: EMPTY,
        ConsoleAutomationBackupFormat: EMPTY,
        MixBusSignalPath: EMPTY,
        DAConversion: EMPTY,
        Recorder: EMPTY,
        StudioNotes: EMPTY
      },
      ReproducerRecorder: {
        ReproducerRecorder: EMPTY,
        Format: EMPTY,
        Tracks: EMPTY,
        TotalMachinesUsed: EMPTY,
        TapeSpeed: EMPTY,
        Tones: EMPTY,
        SMPTERate: EMPTY,
        SyncSource: EMPTY,
        NoiseReductionUsed: EMPTY,
        MediaManufacturer: EMPTY,
        BitDepth: EMPTY,
        SampleRate: EMPTY,
        BitSplit: EMPTY,
        ADConversion: EMPTY,
        ReferenceLevel: EMPTY,
        RRNotes: EMPTY
      },
      Video: {
        EditingSoftware: EMPTY,
        Version: EMPTY,
        Format: EMPTY,
        Resolution: EMPTY,
        ColorSpace: EMPTY,
        SamplingStructure: EMPTY,
        GOPStructure: EMPTY,
        FrameLayout: EMPTY,
        ScreenFormat: EMPTY,
        Bitrate: EMPTY,
        FixedVaried: EMPTY,
        HighestBitrate: EMPTY,
        Fps: EMPTY,
        TimecodeType: EMPTY,
        Length: EMPTY,
        BWColor: EMPTY,
        Audio: {
          AudioFormat: EMPTY,
          SampleRate: EMPTY,
          BitDepth: EMPTY,
          Bitrate: EMPTY,
          Tracks: EMPTY
        },
        VideoNotes: EMPTY
      }
    }
  };
  return builder.create(data).end({pretty: true});
}