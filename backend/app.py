from flask import Flask, jsonify, request
from flask_cors import CORS
from models import db, Meeting
from datetime import datetime

app = Flask(__name__)
CORS(app)  # Allow CORS for frontend to fetch data

# Configure your database URI
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///meetings.db'  # or PostgreSQL URI
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
db.init_app(app)

@app.route('/meeting-names', methods=['GET'])
def get_meeting_names():
    meetings = Meeting.query.with_entities(Meeting.meeting_name).distinct().all()
    names = [m[0] for m in meetings if m[0]]
    return jsonify(names)

@app.route('/attendance-summary', methods=['GET'])
def get_attendance_summary():
    meeting_name = request.args.get('meetingName')
    month = request.args.get('month')  # Format: YYYY-MM

    if not meeting_name or not month:
        return jsonify({'error': 'meetingName and month are required'}), 400

    meetings = Meeting.query.filter_by(meeting_name=meeting_name).all()
    attendees_set = set()
    dates_present_map = {}

    for m in meetings:
        base_attendees = m.attendees if isinstance(m.attendees, list) else (m.attendees or '').split(',')
        attendees_set.update([a.strip() for a in base_attendees])

        for date_str, present_list in (m.present_by_date or {}).items():
            if date_str.startswith(month):
                if date_str not in dates_present_map:
                    dates_present_map[date_str] = []
                dates_present_map[date_str].extend(present_list)

    return jsonify({
        'attendees': sorted(list(attendees_set)),
        'dates': dates_present_map
    })
